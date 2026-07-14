// src/app/api/debug/idle-events/route.ts
// Diagnostic: is the bouncie webhook actually saving trip events to the DB?
// Usage: /api/debug/idle-events?token=critterstop2026

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const total = await prisma.bouncieTripEvent.count();

  // Most recent and oldest events, and distinct IMEIs, to gauge whether data is flowing
  const newest = await prisma.bouncieTripEvent.findFirst({ orderBy: { timestamp: 'desc' }, select: { timestamp: true, imei: true, createdAt: true } });
  const oldest = await prisma.bouncieTripEvent.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } });

  // Count events in the last 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const last7d = await prisma.bouncieTripEvent.count({ where: { timestamp: { gte: weekAgo } } });

  // Distinct devices seen
  const devices = await prisma.$queryRaw<Array<{ imei: string; cnt: bigint }>>`
    SELECT imei, COUNT(*) as cnt FROM bouncie_trip_events GROUP BY imei ORDER BY cnt DESC LIMIT 10
  `;

  // Verify idle events (speed=0) carry valid GPS. Must scope by imei+timestamp to hit the
  // [imei,timestamp] index — a global speed filter scans 2M rows and times out.
  // Use the newest event's imei and look back 2 days.
  let idleSample: Array<{ timestamp: Date; speed: number; lat: number; lng: number; imei: string }> = [];
  if (newest?.imei) {
    const since = new Date(newest.createdAt.getTime() - 2 * 24 * 60 * 60 * 1000);
    const recent = await prisma.bouncieTripEvent.findMany({
      where: { imei: newest.imei, timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, speed: true, lat: true, lng: true, imei: true },
    });
    idleSample = recent.filter(r => r.speed === 0).slice(0, 20);
  }
  const validInSample = idleSample.filter(s => s.lat !== 0 && s.lng !== 0 && s.lat != null && s.lng != null).length;

  return NextResponse.json({
    totalEvents: total,
    eventsLast7Days: last7d,
    newestEvent: newest,
    oldestEvent: oldest,
    topDevices: devices.map(d => ({ imei: d.imei, events: Number(d.cnt) })),
    idleEventGpsCheck: {
      scopedToImei: newest?.imei ?? null,
      idleSampleSize: idleSample.length,
      withValidGps: validInSample,
      withZeroOrNullGps: idleSample.length - validInSample,
      sample: idleSample.slice(0, 8),
    },
    verdict: total === 0
      ? 'EMPTY — webhook is not receiving data (likely not registered in Bouncie dashboard)'
      : last7d === 0
        ? 'STALE — has old data but nothing in last 7 days (webhook may have stopped)'
        : 'ACTIVE — receiving events',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
