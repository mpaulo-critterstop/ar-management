// OnTheClock clock-in/out vs. Bouncie arrival/departure comparison (International Payroll module).
// The tech clocks in/out in OnTheClock; the Hub already computes actual arrival (first trip END at a real
// stop) and departure from Bouncie GPS, stored on TechDayAttendance as startTime/finishTime. This compares
// the two and flags where clock-in is >10 min BEFORE the tech actually arrived at their first stop (paid but
// not yet working), or clock-out is >10 min AFTER they left their last stop.
//
// POST: body { rows: [...parsed OnTheClock CSV rows...] }  → returns per-row comparison with flags.
// OnTheClock has NO API, so the CSV export is uploaded/parsed client-side and posted here.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const GAP_MIN = 10; // acceptable gap in minutes

// Normalize a name for matching: handles "Lastname, Firstname" (OnTheClock) and "Firstname Lastname" (Hub).
function normName(s: string): string {
  if (!s) return '';
  let n = s.trim().toLowerCase();
  if (n.includes(',')) { const [last, first] = n.split(',').map(x => x.trim()); n = `${first} ${last}`; }
  return n.replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const rows: any[] = body.rows || [];
  if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });

  // Load technicians (for name matching) + their attendance in the date span of the upload.
  const techs = await prisma.technician.findMany({ select: { id: true, techId: true, name: true, office: true, startTime: true } });
  const techByName = new Map<string, any>();
  for (const t of techs) techByName.set(normName(t.name), t);

  // Collect the date range from the rows to pull attendance efficiently.
  const dates = rows.map(r => r.date).filter(Boolean).map((d: string) => new Date(d));
  const minD = new Date(Math.min(...dates.map(d => d.getTime()))); minD.setHours(0, 0, 0, 0);
  const maxD = new Date(Math.max(...dates.map(d => d.getTime()))); maxD.setHours(23, 59, 59, 999);

  const attendance = await prisma.techDayAttendance.findMany({
    where: { date: { gte: minD, lte: maxD } },
    select: { techId: true, date: true, startTime: true, finishTime: true, status: true },
  });
  // index attendance by techId + yyyy-mm-dd
  const attByKey = new Map<string, any>();
  for (const a of attendance) attByKey.set(`${a.techId}|${a.date.toISOString().slice(0, 10)}`, a);

  const out = rows.map(r => {
    const tech = techByName.get(normName(r.employeeName));
    const dateKey = r.date ? new Date(r.date).toISOString().slice(0, 10) : '';
    const clockIn = r.firstPunchIn ? new Date(r.firstPunchIn) : null;
    const clockOut = r.lastPunchOut ? new Date(r.lastPunchOut) : null;

    const base: any = {
      employeeName: r.employeeName, employeeNumber: r.employeeNumber, date: dateKey,
      clockIn: clockIn?.toISOString() || null, clockOut: clockOut?.toISOString() || null,
      totalHours: r.totalHours ?? null,
      matched: !!tech, techName: tech?.name || null, office: tech?.office || null,
    };

    if (!tech) return { ...base, status: 'NO_TECH_MATCH', note: 'No matching technician in the Hub' };
    const att = attByKey.get(`${tech.techId}|${dateKey}`);
    if (!att || !att.startTime) return { ...base, status: 'NO_BOUNCIE', note: 'No Bouncie arrival computed for this day' };

    const arrival = new Date(att.startTime);
    const departure = att.finishTime ? new Date(att.finishTime) : null;

    // clock-in gap: positive = clocked in BEFORE arriving (paid-but-not-working minutes)
    const inGapMin = clockIn ? Math.round((arrival.getTime() - clockIn.getTime()) / 60000) : null;
    // clock-out gap: positive = clocked out AFTER leaving last stop
    const outGapMin = (clockOut && departure) ? Math.round((clockOut.getTime() - departure.getTime()) / 60000) : null;

    const inFlag = inGapMin !== null && inGapMin > GAP_MIN;   // arrived well after clock-in
    const outFlag = outGapMin !== null && outGapMin > GAP_MIN; // clocked out well after leaving

    return {
      ...base,
      arrival: arrival.toISOString(),
      departure: departure?.toISOString() || null,
      inGapMin, outGapMin, inFlag, outFlag,
      status: (inFlag || outFlag) ? 'FLAG' : 'OK',
      note: inFlag ? `Clocked in ${inGapMin} min before arriving at first stop` : outFlag ? `Clocked out ${outGapMin} min after leaving last stop` : 'Within tolerance',
    };
  });

  const summary = {
    total: out.length,
    matched: out.filter(o => o.matched).length,
    flagged: out.filter(o => o.status === 'FLAG').length,
    noTech: out.filter(o => o.status === 'NO_TECH_MATCH').length,
    noBouncie: out.filter(o => o.status === 'NO_BOUNCIE').length,
    totalPaidNotWorkingMin: out.filter(o => o.inFlag).reduce((s, o) => s + (o.inGapMin || 0), 0),
    gapThreshold: GAP_MIN,
  };
  return NextResponse.json({ summary, rows: out });
}
