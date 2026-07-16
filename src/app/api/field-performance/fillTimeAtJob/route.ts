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

  // Only attempt records that CAN fill: post-webhook (per-point GPS exists from ~2026-06-28).
  // Pre-webhook nulls are permanently unfillable, so excluding them stops the batcher wasting
  // passes on them. Override with ?since=YYYY-MM-DD if needed.
  const sinceParam = searchParams.get('since') || '2026-06-28';
  const sinceDate = new Date(sinceParam + 'T00:00:00.000Z');
  // Cursor to advance through candidates across calls (avoids re-processing a stuck top batch).
  const offset = parseInt(searchParams.get('offset') || '0');

  // Candidate rows: missing timeAtJobMins, completed, has a tech assigned, post-webhook
  const candidates = await prisma.tcAppointment.findMany({
    where: {
      timeAtJobMins: null,
      apptStatus: 'completed',
      techId: { not: null },
      date: { gte: sinceDate },
      ...(office ? { office } : {}),
    },
    orderBy: { date: 'desc' },
    skip: offset,
    take: limit,
    select: { id: true, frAppointmentId: true, techId: true, customerId: true, date: true, office: true },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ status: 'success', processed: 0, filled: 0, remaining: 0, log: 'No candidates left in window' });
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
      select: { timestamp: true, lat: true, lng: true, speed: true },
    });
    if (points.length === 0) { noGps++; continue; }

    // Points within the customer geofence
    const insideMask = points.map(p => haversineDistance(p.lat, p.lng, coord.lat, coord.lng) <= GEOFENCE_RADIUS_M);
    const inside = points.filter((_, i) => insideMask[i]);
    if (inside.length === 0) { noMatch++; continue; }

    // "Time at job" = arrival → departure at the customer, summed across genuine visits.
    // Key insight: a parked truck with the ENGINE OFF emits NO points — so the tech's dwell shows
    // up as a large time GAP between the arrival point and the departure point, both near the
    // customer. (An engine-running idle stop shows continuous points instead.) Either way, the
    // measure is first-inside → last-inside timestamp for a visit.
    // A NEW visit only begins when, between two in-geofence points, the truck was actually seen
    // LEAVING (a point outside the geofence in between). A data gap alone (engine off) is NOT a
    // new visit — it's the tech parked and working.
    let totalMins = 0;
    let visits = 0;
    let visitStart = inside[0].timestamp.getTime();
    let visitEnd = visitStart;
    // Walk the FULL point stream; track whether we left the geofence between inside points.
    let lastWasInside = false;
    let leftSinceLastInside = false;
    for (let i = 0; i < points.length; i++) {
      if (insideMask[i]) {
        const t = points[i].timestamp.getTime();
        if (!lastWasInside && leftSinceLastInside && visitEnd !== visitStart) {
          // Re-entered after genuinely leaving → close previous visit, start new
          totalMins += (visitEnd - visitStart) / 60000;
          visits++;
          visitStart = t;
        }
        visitEnd = t;
        lastWasInside = true;
        leftSinceLastInside = false;
      } else {
        // outside point → the truck physically left the geofence
        if (lastWasInside) leftSinceLastInside = true;
        lastWasInside = false;
      }
    }
    totalMins += (visitEnd - visitStart) / 60000; // final visit
    visits++;
    const mins = totalMins;

    // Sanity bound: <5 min is treated as unreliable (missing Bouncie trip data, or too brief to be
    // a real service visit) → leave NULL rather than write a misleadingly-low number. Cap 5 hours.
    if (mins < 5 || mins > 300) { noMatch++; continue; }

    if (!dryRun) {
      await prisma.tcAppointment.update({ where: { id: appt.id }, data: { timeAtJobMins: Math.round(mins * 10) / 10 } });
    }
    filled++;
    if (samples.length < 12) samples.push({ frAppointmentId: appt.frAppointmentId, date: dayStr, office: appt.office, mins: Math.round(mins * 10) / 10, points: inside.length, visits });
  }

  const remaining = await prisma.tcAppointment.count({
    where: { timeAtJobMins: null, apptStatus: 'completed', techId: { not: null }, date: { gte: sinceDate }, ...(office ? { office } : {}) },
  });

  // If nothing filled this batch, the current window is all-unfillable — caller should advance offset.
  const stuckAdvanceHint = (filled === 0 && candidates.length === limit)
    ? `Nothing fillable in this batch — retry with &offset=${offset + limit} to step past unfillable records.`
    : null;

  log.push(`Window: >= ${sinceParam}, offset ${offset}, batch ${candidates.length}`);
  log.push(`Filled: ${filled}${dryRun ? ' (DRY RUN — not written)' : ''}`);
  log.push(`Skipped — no imei: ${noImei}, no coords: ${noCoords}, no GPS: ${noGps}, no match: ${noMatch}`);
  log.push(`Remaining null in window: ${remaining}`);
  if (stuckAdvanceHint) log.push(stuckAdvanceHint);

  return NextResponse.json({
    status: 'success',
    processed: candidates.length,
    filled,
    remaining,
    nextOffset: filled === 0 ? offset + limit : offset,
    stuckAdvanceHint,
    breakdown: { noImei, noCoords, noGps, noMatch },
    samples,
    dryRun,
    log: log.join('\n'),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
