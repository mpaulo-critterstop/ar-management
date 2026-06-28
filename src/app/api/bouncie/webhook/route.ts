// src/app/api/bouncie/webhook/route.ts
// Receives real-time tripData push events from Bouncie
// Stores per-point GPS + timestamp + speed for start-of-day idle detection
// Register this URL in Bouncie via /api/bouncie/register-webhook

export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate authKey from Bouncie
    const authKey = req.headers.get('authorization') || body.authKey;
    if (authKey !== 'critterstop-cron-2024' && authKey !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventType, imei, transactionId, data } = body;

    // Only process tripData events
    if (eventType !== 'tripData') {
      return NextResponse.json({ status: 'ignored', eventType });
    }

    if (!imei || !transactionId || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ status: 'skipped', reason: 'missing fields' });
    }

    // Build records from each data point
    const records = data
      .filter((pt: any) => pt.timestamp && pt.gps?.lat != null && pt.gps?.lon != null)
      .map((pt: any) => ({
        transactionId: String(transactionId),
        imei: String(imei),
        timestamp: new Date(pt.timestamp),
        speed: pt.speed ?? 0,
        lat: pt.gps.lat,
        lng: pt.gps.lon,
      }));

    if (records.length === 0) {
      return NextResponse.json({ status: 'skipped', reason: 'no valid points' });
    }

    // Insert in batches of 500 — skip duplicates
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const result = await prisma.bouncieTripEvent.createMany({
        data: batch,
        skipDuplicates: false, // no unique constraint on individual points
      });
      inserted += result.count;
    }

    return NextResponse.json({ status: 'ok', inserted, total: records.length });

  } catch (e: any) {
    console.error('Bouncie webhook error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET for health check
export async function GET() {
  return NextResponse.json({ status: 'Bouncie webhook receiver active' });
}
