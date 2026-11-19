import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // all weeks, oldest first — show the date range + which are suspiciously old
  const weeks = await prisma.payrollWeek.findMany({ orderBy: { weekDate: 'asc' }, select: { id: true, weekDate: true, region: true, status: true, _count: { select: { entries: true } } } });
  const oldest = weeks.slice(0, 15).map(w => ({ date: w.weekDate.toISOString().split('T')[0], region: w.region, entries: w._count.entries }));
  // a sample 2019 week's entries
  const w2019 = weeks.find(w => w.weekDate.getUTCFullYear() === 2019);
  let sample: any = null;
  if (w2019) {
    const ents = await prisma.payrollEntry.findMany({ where: { weekId: w2019.id }, take: 3 });
    sample = { week: w2019.weekDate.toISOString().split('T')[0], entries: ents.map(e => ({ name: e.name, rate: e.rate, regHrs: e.regularHours, otHrs: e.otHours, otTotalOverride: e.otTotalOverride, finalTotalOverride: e.finalTotalOverride, tolls: e.tolls, otherEarnings: e.otherEarnings })) };
  }
  return NextResponse.json({ totalWeeks: weeks.length, dateRange: { oldest: weeks[0]?.weekDate.toISOString().split('T')[0], newest: weeks[weeks.length-1]?.weekDate.toISOString().split('T')[0] }, oldest15: oldest, sample2019: sample });
}
