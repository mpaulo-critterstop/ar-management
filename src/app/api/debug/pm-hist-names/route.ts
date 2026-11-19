import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // ALL distinct per-PM scopes across ALL history, with totals + date range
  const rows = await prisma.kpiHistory.findMany({ where: { scope: { not: 'company' } } });
  const byScope: Record<string, any> = {};
  for (const h of rows) {
    if (!byScope[h.scope]) byScope[h.scope] = { monthlyBooked: 0, monthlyRows: 0, weeklyBooked: 0, weeklyRows: 0, keys: [] as string[] };
    const s = byScope[h.scope];
    if (h.period === 'monthly') { s.monthlyBooked += h.booked; s.monthlyRows++; }
    else { s.weeklyBooked += h.booked; s.weeklyRows++; }
    if (s.keys.length < 3) s.keys.push(`${h.period}:${h.periodKey}`);
  }
  const scopes = Object.keys(byScope).sort();
  // search for anything mentioning these first names / "Performance Tracker"
  const terms = ['chisam','jonathan','david','justin','ryan','joey','kenny','roderick','jacob','ferreira','liles','rogers','connor','lowe','barrett','stanford','fenton','reiter','performance'];
  const matches = scopes.filter(s => terms.some(t => s.toLowerCase().includes(t)));
  return NextResponse.json({
    totalDistinctScopes: scopes.length,
    allScopes: scopes,
    matchesForTerminatedPMs: matches.map(m => ({ name: m, ...byScope[m] })),
  });
}
