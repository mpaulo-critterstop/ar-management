// src/app/api/cron/geocode/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
const BATCH_SIZE = 50;
const DELAY_MS = 50;

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
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    const session = await getServerSession(authOptions);
    if (!session || !['ADMIN', 'MANAGER'].includes((session.user as any)?.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Use raw SQL to find customers without lat — avoids Prisma client cache issues
  const customers = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    billingAddr: string | null;
    serviceAddr: string | null;
  }>>`
    SELECT id, name, "billingAddr", "serviceAddr"
    FROM customers
    WHERE "billingAddr" IS NOT NULL
      AND lat IS NULL
    ORDER BY "createdAt" ASC
    LIMIT ${BATCH_SIZE}
  `;

  // Debug: log what we found
  console.log('Geocode query returned:', customers.length, 'customers');

  if (customers.length === 0) {
    const remaining = await prisma.$queryRaw<[{count: bigint}]>`
      SELECT COUNT(*) as count FROM customers WHERE "billingAddr" IS NOT NULL AND lat IS NULL
    `;
    const rem = Number(remaining[0].count);
    return NextResponse.json({ status: 'done', message: 'All customers already geocoded', geocoded: 0, remaining: rem });
  }

  let geocoded = 0;
  let failed = 0;
  const failures: string[] = [];

  console.log('First customer to geocode:', customers[0]?.id, customers[0]?.billingAddr);

  for (const customer of customers) {
    const address = customer.serviceAddr || customer.billingAddr;
    if (!address) continue;

    const coords = await geocodeAddress(address);
    console.log('Geocode result for', address?.slice(0, 30), ':', coords ? 'OK' : 'FAILED');

    if (coords) {
      await prisma.$executeRaw`
        UPDATE customers SET lat = ${coords.lat}, lng = ${coords.lng}, "geocodedAt" = NOW()
        WHERE id = ${customer.id}
      `;
      geocoded++;
    } else {
      failed++;
      failures.push(`${customer.name}: ${address}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const remaining = await prisma.$queryRaw<[{count: bigint}]>`
    SELECT COUNT(*) as count FROM customers WHERE "billingAddr" IS NOT NULL AND lat IS NULL
  `;
  const rem = Number(remaining[0].count);

  return NextResponse.json({
    status: 'success',
    geocoded,
    failed,
    remaining: rem,
    needsMoreRuns: rem > 0,
    failures: failures.slice(0, 10),
  });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const total = await prisma.$queryRaw<[{count: bigint}]>`SELECT COUNT(*) as count FROM customers WHERE "billingAddr" IS NOT NULL`;
  const geocoded = await prisma.$queryRaw<[{count: bigint}]>`SELECT COUNT(*) as count FROM customers WHERE lat IS NOT NULL`;
  const t = Number(total[0].count);
  const g = Number(geocoded[0].count);

  return NextResponse.json({ total: t, geocoded: g, remaining: t - g, pctDone: t > 0 ? ((g/t)*100).toFixed(1) + '%' : '0%' });
}
