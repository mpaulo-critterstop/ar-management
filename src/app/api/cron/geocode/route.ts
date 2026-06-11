// src/app/api/cron/geocode/route.ts
// One-time + ongoing: geocodes customer addresses using Google Maps Geocoding API
// Stores lat/lng on Customer record for use in reliability geofencing

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
const BATCH_SIZE = 50; // Process 50 at a time to avoid timeout
const DELAY_MS = 50;  // 50ms between requests = ~20/sec, well within Google limits

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.length) return null;
    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Auth: allow cron or admin
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    const session = await getServerSession(authOptions);
    if (!session || !['ADMIN', 'MANAGER'].includes((session.user as any)?.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const forceAll = body.forceAll === true; // re-geocode all even if already done

  // Find customers needing geocoding
  const customers = await prisma.customer.findMany({
    where: {
      billingAddr: { not: null },
      ...(forceAll ? {} : { lat: null }),
    },
    select: { id: true, name: true, billingAddr: true, serviceAddr: true },
    take: BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
  });

  if (customers.length === 0) {
    return NextResponse.json({ status: 'done', message: 'All customers already geocoded', geocoded: 0 });
  }

  let geocoded = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const customer of customers) {
    // Prefer serviceAddr over billingAddr for accuracy
    const address = customer.serviceAddr || customer.billingAddr;
    if (!address) continue;

    const coords = await geocodeAddress(address);

    if (coords) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { lat: coords.lat, lng: coords.lng, geocodedAt: new Date() },
      });
      geocoded++;
    } else {
      failed++;
      failures.push(`${customer.name}: ${address}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Check how many still need geocoding
  const remaining = await prisma.customer.count({
    where: { billingAddr: { not: null }, lat: null },
  });

  return NextResponse.json({
    status: 'success',
    geocoded,
    failed,
    remaining,
    needsMoreRuns: remaining > 0,
    failures: failures.slice(0, 10), // show first 10 failures
  });
}

export async function GET(req: NextRequest) {
  // Status check
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const total = await prisma.customer.count({ where: { billingAddr: { not: null } } });
  const geocoded = await prisma.customer.count({ where: { lat: { not: null } } });
  const remaining = total - geocoded;

  return NextResponse.json({ total, geocoded, remaining, pctDone: total > 0 ? ((geocoded/total)*100).toFixed(1) + '%' : '0%' });
}
