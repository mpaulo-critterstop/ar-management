import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // all distinct per-PM scopes in kpiHistory (monthly + weekly) + their totals
  const rows = await prisma.kpiHistory.findMany({ where: { scope: { not: 'company' } } });
  const byScope: Record<string, { monthlyBooked: number; monthlyRows: number; weeklyBooked: number; weeklyRows: number }> = {};
  for (const h of rows) {
    if (!byScope[h.scope]) byScope[h.scope] = { monthlyBooked: 0, monthlyRows: 0, weeklyBooked: 0, weeklyRows: 0 };
    if (h.period === 'monthly') { byScope[h.scope].monthlyBooked += h.booked; byScope[h.scope].monthlyRows++; }
    else { byScope[h.scope].weeklyBooked += h.booked; byScope[h.scope].weeklyRows++; }
  }
  // which are in the current PM table (have office)?
  const pms = await prisma.pM.findMany();
  const pmNames = new Set(pms.map(p => p.name.toLowerCase()));
  const officeByPm: Record<string, string> = {}; for (const p of pms) officeByPm[p.name.toLowerCase()] = p.office;
  const targets = ['Roderick Stanford','Justin Rogers','Kenny Barrett',"Ryan O'Connor",'Joey Lowe','David Liles','Chisam Reiter','Jonathan Ferreira','Jacob Fenton'];
  const scopes = Object.keys(byScope).sort();
  const result = scopes.map(s => ({ name: s, ...byScope[s], inPMTable: pmNames.has(s.toLowerCase()), currentOffice: officeByPm[s.toLowerCase()] || null }));
  // match targets
  const targetMatch = targets.map(t => {
    const exact = scopes.find(s => s.toLowerCase() === t.toLowerCase());
    const fuzzy = exact ? null : scopes.find(s => s.toLowerCase().includes(t.split(' ')[0].toLowerCase()) && s.toLowerCase().includes(t.split(' ').slice(-1)[0].toLowerCase()));
    return { target: t, exactMatchInHistory: exact || null, possibleMatch: fuzzy || null };
  });
  return NextResponse.json({ allPerPmScopes: result, targetMatch });
}
