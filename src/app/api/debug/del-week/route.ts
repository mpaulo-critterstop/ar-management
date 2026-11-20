import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // delete ALL non-Monday weeks (both regions) that have no entered data
  const weeks = await prisma.payrollWeek.findMany({ include: { entries: { select: { regularHours: true, otHours: true, otherEarnings: true, tolls: true, otherDeductions: true, commissions: true, bonus: true } } } });
  const del: string[] = [];
  for (const w of weeks) {
    const dow = w.weekDate.getUTCDay();
    const hasData = w.entries.some(e => e.regularHours || e.otHours || e.otherEarnings || e.tolls || e.otherDeductions || e.commissions || e.bonus);
    if (dow !== 1 && !hasData) { // not Monday + no data
      if (sp.get('confirm') === '1') await prisma.payrollWeek.delete({ where: { id: w.id } });
      del.push(`${w.weekDate.toISOString().split('T')[0]} ${w.region}`);
    }
  }
  return NextResponse.json({ confirmed: sp.get('confirm') === '1', nonMondayEmptyWeeks: del });
}
