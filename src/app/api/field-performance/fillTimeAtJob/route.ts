// src/app/api/field-performance/fillTimeAtJob/route.ts
// Fills missing timeAtJobMins on tc_appointments using per-point GPS (bouncie_trip_events).
// "Option C": measures actual time within the customer's geofence — engine on OR off — instead of
// the trip-endpoint gap method, which structurally misses ~13% (engine-left-running, last-stop-of-day,
// customer not in tech_route_customers, dwell outside bounds).
//
// GAP-FILL ONLY: only touches rows where timeAtJobMins IS NULL. Existing values are left untouched.
//
// Usage: /api/field-performance/fillTimeAtJob?token=critterstop2026&limit=300[&office=DFW][&dryRun=true]
//   Process in batches via limit; repeat until processed=0. dryRun computes but does not write.

export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const GEOFENCE_RADIUS_M = 500;

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit  = Math.min(parseInt(searchParams.get('limit') || '300'), 1000);
  const office = searchParams.get('office') || undefined;
  const dryRun = searchParams.get('dryRun') === 'true';

  const log: string[] = [];

  // Candidate rows: missing timeAtJobMins, completed, has a tech assigned
  const candidates = await prisma.tcAppointment.findMany({
    where: {
      timeAtJobMins: null,
      apptStatus: 'completed',
      techId: { not: null },
      ...(office ? { office } : {}),
    },
    orderBy: { date: 'desc' },
    take: limit,
    select: { id: true, frAppointmentId: true, techId: true, customerId: true, date: true, office: true },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ status: 'success', processed: 0, filled: 0, remaining: 0, log: ['No candidates left'].join('\n') });
  }

  // Map techId -> imei (via bouncie_devices.deviceId)
  const techIds = [...new Set(candidates.map(c => c.techId!))];
  const techs = await prisma.technician.findMany({
    where: { techId: { in: techIds } },
    select: { techId: true, bouncieDevice: { select: { deviceId: true } } },
  });
  const techToImei = new Map<string, string>();
  for (const t of techs) if (t.bouncieDevice?.deviceId) techToImei.set(t.techId, t.bouncieDevice.deviceId);

  // Map customerId (FR external id) -> coords (via customers.externalId)
  const custIds = [...new Set(candidates.map(c => c.customerId).filter(Boolean) as string[])];
  const custs = await prisma.customer.findMany({
    where: { externalId: { in: custIds }, lat: { not: null }, lng: { not: null } },
    select: { externalId: true, lat: true, lng: true },
  });
  const custCoords = new Map<string, { lat: number; lng: number }>();
  for (const c of custs) if (c.externalId) custCoords.set(c.externalId, { lat: c.lat!, lng: c.lng! });

  let filled = 0;
  const samples: any[] = [];
  let noImei = 0, noCoords = 0, noGps = 0, noMatch = 0;

  for (const appt of candidates) {
    const imei = techToImei.get(appt.techId!);
    if (!imei) { noImei++; continue; }
    const coord = appt.customerId ? custCoords.get(appt.customerId) : null;
    if (!coord) { noCoords++; continue; }

    // Day window in UTC (generous: covers the full local day)
    const dayStr = appt.date.toISOString().split('T')[0];
    const dayStart = new Date(dayStr + 'T09:00:00.000Z'); // ~4AM CST
    const dayEnd   = new Date(dayStr + 'T05:00:00.000Z'); // ~11PM CST (next UTC day)
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Pull this tech's GPS points for the day (scoped to imei+timestamp → uses index)
    const points = await prisma.bouncieTripEvent.findMany({
      where: { imei, timestamp: { gte: dayStart, lte: dayEnd } },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, lat: true, lng: true },
    });
    if (points.length === 0) { noGps++; continue; }

    // Points within the customer geofence
    const inside = points.filter(p => haversineDistance(p.lat, p.lng, coord.lat, coord.lng) <= GEOFENCE_RADIUS_M);
    if (inside.length === 0) { noMatch++; continue; }

    // Sum contiguous visit segments (not first-to-last span, which would merge separate
    // visits and count the gap between them). A gap > GAP_BREAK_MS between consecutive
    // in-geofence points means the tech left and came back — a new visit.
    // Points are ~5s apart while parked; use a 5-min break threshold.
    const GAP_BREAK_MS = 5 * 60 * 1000;
    let totalMins = 0;
    let segStart = inside[0].timestamp.getTime();
    let prev = segStart;
    let visits = 0;
    for (let i = 1; i < inside.length; i++) {
      const t = inside[i].timestamp.getTime();
      if (t - prev > GAP_BREAK_MS) {
        // close current segment
        totalMins += (prev - segStart) / 60000;
        if (prev - segStart > 0) visits++;
        segStart = t;
      }
      prev = t;
    }
    totalMins += (prev - segStart) / 60000; // final segment
    if (prev - segStart > 0) visits++;
    const mins = totalMins;

    // Sanity bound: 0.5 min to 4 hours total across the day
    if (mins < 0.5 || mins > 240) { noMatch++; continue; }

    if (!dryRun) {
      await prisma.tcAppointment.update({ where: { id: appt.id }, data: { timeAtJobMins: Math.round(mins * 10) / 10 } });
    }
    filled++;
    if (samples.length < 12) samples.push({ frAppointmentId: appt.frAppointmentId, date: dayStr, office: appt.office, mins: Math.round(mins * 10) / 10, points: inside.length, visits });
  }

  const remaining = await prisma.tcAppointment.count({
    where: { timeAtJobMins: null, apptStatus: 'completed', techId: { not: null }, ...(office ? { office } : {}) },
  });

  log.push(`Candidates this batch: ${candidates.length}`);
  log.push(`Filled: ${filled}${dryRun ? ' (DRY RUN — not written)' : ''}`);
  log.push(`Skipped — no imei: ${noImei}, no customer coords: ${noCoords}, no GPS that day: ${noGps}, no in-geofence match: ${noMatch}`);
  log.push(`Remaining null (completed, has tech): ${remaining}`);

  return NextResponse.json({
    status: 'success',
    processed: candidates.length,
    filled,
    remaining,
    breakdown: { noImei, noCoords, noGps, noMatch },
    samples,
    dryRun,
    log: log.join('\n'),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
