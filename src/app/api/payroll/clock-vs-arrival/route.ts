// US Payroll — Clock-In vs Arrival.
// Reads the ACCURATE, already-computed Bouncie arrival/departure from TechDayAttendance (populated by the
// Field Performance reliability cron — its start/end-of-day logic is more accurate than a reimplementation).
// Keeps the separation the user wanted via filtering: only ACTIVE technicians, matched to the uploaded
// OnTheClock CSV, reading per-DAY records (so the cron's Fri-week framing is irrelevant — each CSV row matches
// its own date). Ex-employees never appear (not active, not in the CSV).
// Requires the reliability cron to have run for the CSV's dates.
// TIMEZONE: OnTheClock CSV datetimes are Central-local (no zone marker) — parsed explicitly as
// America/Chicago -> UTC so they line up with the attendance timestamps (stored UTC).
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const GAP_MIN = 10;

function parseCentralToUTC(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  const [, mo, d, y, h, mi, se, ap] = m;
  let hr = parseInt(h); const ap2 = ap.toUpperCase();
  if (ap2 === 'PM' && hr !== 12) hr += 12;
  if (ap2 === 'AM' && hr === 12) hr = 0;
  const guessUTC = Date.UTC(+y, +mo - 1, +d, hr, +mi, +se);
  const asIfUTC = new Date(guessUTC);
  const localMs = new Date(asIfUTC.toLocaleString('en-US', { timeZone: 'America/Chicago' })).getTime();
  const utcMs = new Date(asIfUTC.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(guessUTC - (localMs - utcMs));
}

const normName = (s: string) => {
  if (!s) return '';
  let n = s.trim().toLowerCase();
  if (n.includes(',')) { const [last, first] = n.split(',').map(x => x.trim()); n = `${first} ${last}`; }
  return n.replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const rows: any[] = body.rows || [];
  if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });

  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE' as any },
    select: { id: true, techId: true, name: true, office: true },
  });
  const techByName = new Map<string, any>();
  for (const t of techs) techByName.set(normName(t.name), t);

  const parsed = rows.map(r => ({
    employeeName: r.employeeName, employeeNumber: r.employeeNumber, date: r.date,
    clockIn: parseCentralToUTC(r.firstPunchIn), clockOut: parseCentralToUTC(r.lastPunchOut),
    totalHours: r.totalHours ?? null, tech: techByName.get(normName(r.employeeName)),
  }));
  const matched = parsed.filter(p => p.tech);

  const attByKey = new Map<string, any>();
  if (matched.length) {
    const dts = matched.map(p => new Date(p.date)).filter(d => !isNaN(d.getTime()));
    const minD = new Date(Math.min(...dts.map(d => d.getTime()))); minD.setHours(0, 0, 0, 0);
    const maxD = new Date(Math.max(...dts.map(d => d.getTime()))); maxD.setHours(23, 59, 59, 999);
    const att = await prisma.techDayAttendance.findMany({
      where: { techId: { in: matched.map(p => p.tech.techId) }, date: { gte: minD, lte: maxD } },
      select: { techId: true, date: true, startTime: true, finishTime: true, status: true },
    });
    for (const a of att) attByKey.set(`${a.techId}|${a.date.toISOString().slice(0, 10)}`, a);
  }

  const out = matched.map(p => {
    const dayKey = new Date(p.date).toLocaleDateString('en-CA');
    const att = attByKey.get(`${p.tech.techId}|${dayKey}`);
    const base: any = {
      employeeName: p.employeeName, employeeNumber: p.employeeNumber, date: dayKey,
      techName: p.tech.name, office: p.tech.office, matched: true,
      clockIn: p.clockIn?.toISOString() || null, clockOut: p.clockOut?.toISOString() || null, totalHours: p.totalHours,
    };
    if (!att || !att.startTime) return { ...base, status: 'NO_BOUNCIE', note: 'No arrival on record for this day — run the reliability sync for this date, or the truck had no matched stops' };
    const arrival = new Date(att.startTime), departure = att.finishTime ? new Date(att.finishTime) : null;
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

  const unmatched = parsed.filter(p => !p.tech).map(p => ({
    employeeName: p.employeeName, employeeNumber: p.employeeNumber, date: new Date(p.date).toLocaleDateString('en-CA'),
    clockIn: p.clockIn?.toISOString() || null, clockOut: p.clockOut?.toISOString() || null,
    status: 'NO_MATCH', note: 'No active technician matches this name',
  }));

  const all = [...out, ...unmatched];
  return NextResponse.json({
    summary: {
      total: all.length, matched: out.length,
      flagged: out.filter((o: any) => o.status === 'FLAG').length,
      noMatch: unmatched.length,
      noBouncie: out.filter((o: any) => o.status === 'NO_BOUNCIE').length,
      totalPaidNotWorkingMin: out.filter((o: any) => o.inFlag).reduce((s: number, o: any) => s + (o.inGapMin || 0), 0),
      gapThreshold: GAP_MIN,
    },
    rows: all,
  });
}
