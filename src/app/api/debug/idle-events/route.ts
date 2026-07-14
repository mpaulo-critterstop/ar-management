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

  // Verify idle events (speed=0) actually carry valid GPS — the whole idle-detection feature depends on this
  const idleTotal = await prisma.bouncieTripEvent.count({ where: { speed: 0 } });
  const idleValidGps = await prisma.bouncieTripEvent.count({
    where: { speed: 0, NOT: { lat: 0, lng: 0 } },
  });
  const idleSample = await prisma.bouncieTripEvent.findMany({
    where: { speed: 0 },
    orderBy: { timestamp: 'desc' },
    take: 5,
    select: { timestamp: true, speed: true, lat: true, lng: true, imei: true },
  });

  return NextResponse.json({
    totalEvents: total,
    eventsLast7Days: last7d,
    newestEvent: newest,
    oldestEvent: oldest,
    topDevices: devices.map(d => ({ imei: d.imei, events: Number(d.cnt) })),
    idleEvents: {
      totalSpeedZero: idleTotal,
      withValidGps: idleValidGps,
      withZeroOrNullGps: idleTotal - idleValidGps,
      sampleRecent: idleSample,
    },
    verdict: total === 0
      ? 'EMPTY — webhook is not receiving data (likely not registered in Bouncie dashboard)'
      : last7d === 0
        ? 'STALE — has old data but nothing in last 7 days (webhook may have stopped)'
        : 'ACTIVE — receiving events',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
