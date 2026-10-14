// US Payroll — Clock-In vs Arrival. Fully self-contained (does NOT read Field Performance's TechDayAttendance,
// so no Fri-week framing and no ex-employees). For each OnTheClock CSV row, it matches the employee to a
// Technician that HAS a Bouncie device, computes that day's arrival/departure on demand from raw Bouncie trips
// (America/Chicago), and flags clock-in >10 min before arrival / clock-out >10 min after departure.
//
// TIMEZONE FIX: OnTheClock CSV datetimes ("10/6/2026 8:16:00 AM") are Central local with NO zone marker.
// We parse them explicitly as America/Chicago → correct UTC instant, so they line up with Bouncie's UTC.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getBouncieToken, computeArrivalsForImei } from '@/lib/bouncieArrival';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const GAP_MIN = 10;

// Parse "M/D/YYYY h:mm:ss AM" as America/Chicago → UTC Date. Central is UTC-6 (CST) or UTC-5 (CDT); we
// determine the offset for that specific date using the zone, so DST is handled correctly.
function parseCentralToUTC(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let [, mo, d, y, h, mi, se, ap] = m;
  let hr = parseInt(h); const ap2 = ap.toUpperCase();
  if (ap2 === 'PM' && hr !== 12) hr += 12;
  if (ap2 === 'AM' && hr === 12) hr = 0;
  const Y = +y, M = +mo, D = +d, Mi = +mi, S = +se;
  // Build a UTC guess, then correct by the zone's offset for that instant.
  const guessUTC = Date.UTC(Y, M - 1, D, hr, Mi, S);
  // Offset of America/Chicago at this wall-clock time:
  const asIfUTC = new Date(guessUTC);
  const tzStr = asIfUTC.toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const localMs = new Date(tzStr).getTime();
  const utcMs = new Date(asIfUTC.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const offsetMs = localMs - utcMs; // Central is behind UTC → negative
  return new Date(guessUTC - offsetMs);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const rows: any[] = body.rows || [];
  if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });

  const normName = (s: string) => {
    if (!s) return '';
    let n = s.trim().toLowerCase();
    if (n.includes(',')) { const [last, first] = n.split(',').map(x => x.trim()); n = `${first} ${last}`; }
    return n.replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  };

  // Only ACTIVE techs that HAVE a Bouncie device — matching set (point 5: only cross-check matching techs).
  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE' as any, bouncieDevice: { isNot: null } },
    select: { id: true, name: true, office: true, bouncieDevice: { select: { deviceId: true } } },
  });
  const techByName = new Map<string, any>();
  for (const t of techs) if (t.bouncieDevice?.deviceId) techByName.set(normName(t.name), t);

  // Parse all CSV rows (Central→UTC). Keep only rows that match a Bouncie tech.
  const parsed = rows.map(r => {
    const tech = techByName.get(normName(r.employeeName));
    return {
      employeeName: r.employeeName, employeeNumber: r.employeeNumber, date: r.date,
      clockIn: parseCentralToUTC(r.firstPunchIn), clockOut: parseCentralToUTC(r.lastPunchOut),
      totalHours: r.totalHours ?? null, tech,
    };
  });

  const matched = parsed.filter(p => p.tech);
  if (!matched.length) {
    return NextResponse.json({
      summary: { total: parsed.length, matched: 0, flagged: 0, noMatch: parsed.length, noBouncie: 0, totalPaidNotWorkingMin: 0, gapThreshold: GAP_MIN },
      rows: parsed.map(p => ({ employeeName: p.employeeName, employeeNumber: p.employeeNumber, date: p.date, clockIn: p.clockIn?.toISOString() || null, clockOut: p.clockOut?.toISOString() || null, status: 'NO_MATCH', note: 'No active technician with a Bouncie device matches this name' })),
    });
  }

  // Date span for Bouncie trip fetch (pad ±1 day for timezone edges).
  const dates = matched.map(p => new Date(p.date)).filter(d => !isNaN(d.getTime()));
  const minD = new Date(Math.min(...dates.map(d => d.getTime()))); minD.setDate(minD.getDate() - 1);
  const maxD = new Date(Math.max(...dates.map(d => d.getTime()))); maxD.setDate(maxD.getDate() + 2);
  const startISO = minD.toISOString(), endISO = maxD.toISOString();

  // Geocoded customers (for arrival detection) — pulled once, bounded to the techs' offices.
  const offices = [...new Set(techs.map(t => t.office).filter(Boolean))];
  const custRows = await prisma.customer.findMany({
    where: { office: { in: offices as string[] }, lat: { not: null }, lng: { not: null } },
    select: { lat: true, lng: true }, take: 60000,
  });
  const customerCoords = custRows.map(c => ({ lat: c.lat!, lng: c.lng! }));

  // Bouncie token + compute arrivals per unique imei (dedupe so we fetch each truck once).
  let token: string;
  try { token = await getBouncieToken(); }
  catch (e: any) { return NextResponse.json({ error: 'Bouncie auth failed: ' + String(e).slice(0, 150) }, { status: 502 }); }

  const imeis = [...new Set(matched.map(p => p.tech.bouncieDevice.deviceId))];
  const arrivalsByImei = new Map<string, Map<string, any>>();
  for (const imei of imeis) {
    try { arrivalsByImei.set(imei, await computeArrivalsForImei(imei, token, startISO, endISO, customerCoords)); }
    catch { arrivalsByImei.set(imei, new Map()); }
  }

  const out = matched.map(p => {
    const imei = p.tech.bouncieDevice.deviceId;
    const dayKey = new Date(p.date).toLocaleDateString('en-CA'); // the CSV date as YYYY-MM-DD
    const day = arrivalsByImei.get(imei)?.get(dayKey);
    const base: any = {
      employeeName: p.employeeName, employeeNumber: p.employeeNumber, date: dayKey,
      techName: p.tech.name, office: p.tech.office,
      clockIn: p.clockIn?.toISOString() || null, clockOut: p.clockOut?.toISOString() || null,
      totalHours: p.totalHours, matched: true,
    };
    if (!day || !day.arrival) return { ...base, status: 'NO_BOUNCIE', note: 'No Bouncie arrival computed for this day (no matched stops / truck off)' };

    const arrival = new Date(day.arrival), departure = day.departure ? new Date(day.departure) : null;
    const inGapMin = p.clockIn ? Math.round((arrival.getTime() - p.clockIn.getTime()) / 60000) : null;
    const outGapMin = (p.clockOut && departure) ? Math.round((p.clockOut.getTime() - departure.getTime()) / 60000) : null;
    const inFlag = inGapMin !== null && inGapMin > GAP_MIN;
    const outFlag = outGapMin !== null && outGapMin > GAP_MIN;
    return {
      ...base, arrival: arrival.toISOString(), departure: departure?.toISOString() || null,
      inGapMin, outGapMin, inFlag, outFlag,
      status: (inFlag || outFlag) ? 'FLAG' : 'OK',
      note: inFlag ? `Clocked in ${inGapMin} min before arriving at first stop` : outFlag ? `Clocked out ${outGapMin} min after leaving last stop` : 'Within tolerance',
    };
  });

  // Rows with no tech match (shown separately so the user knows who wasn't checked).
  const unmatched = parsed.filter(p => !p.tech).map(p => ({
    employeeName: p.employeeName, employeeNumber: p.employeeNumber, date: new Date(p.date).toLocaleDateString('en-CA'),
    clockIn: p.clockIn?.toISOString() || null, clockOut: p.clockOut?.toISOString() || null,
    status: 'NO_MATCH', note: 'No active technician with a Bouncie device matches this name',
  }));

  const all = [...out, ...unmatched];
  const summary = {
    total: all.length,
    matched: out.length,
    flagged: out.filter((o: any) => o.status === 'FLAG').length,
    noMatch: unmatched.length,
    noBouncie: out.filter((o: any) => o.status === 'NO_BOUNCIE').length,
    totalPaidNotWorkingMin: out.filter((o: any) => o.inFlag).reduce((s: number, o: any) => s + (o.inGapMin || 0), 0),
    gapThreshold: GAP_MIN,
  };
  return NextResponse.json({ summary, rows: all });
}
