import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = sp.get('date'); const region = sp.get('region') || 'US';
  if (!date) {
    // list all weeks with day-of-week
    const weeks = await prisma.payrollWeek.findMany({ include: { entries: { select: { backfilled: true, regularHours: true, otherEarnings: true } } } });
    return NextResponse.json({ weeks: weeks.map(w => ({ id: w.id, date: w.weekDate.toISOString().split('T')[0], region: w.region, entries: w.entries.length, hasData: w.entries.some(e => e.regularHours || e.otherEarnings) })) });
  }
  if (sp.get('confirm') !== '1') return NextResponse.json({ note: 'add &confirm=1 to delete', date, region });
  const wk = await prisma.payrollWeek.findFirst({ where: { weekDate: new Date(date + 'T00:00:00.000Z'), region } });
  if (!wk) return NextResponse.json({ error: 'not found' });
  await prisma.payrollWeek.delete({ where: { id: wk.id } });
  return NextResponse.json({ ok: true, deleted: date, region });
}
