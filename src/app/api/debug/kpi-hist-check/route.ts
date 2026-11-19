import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('key') || '2026-03'; // a frozen month to test
  // company row
  const company = await prisma.kpiHistory.findFirst({ where: { period: 'monthly', scope: 'company', periodKey: key } });
  // per-PM rows for that month
  const pmRows = await prisma.kpiHistory.findMany({ where: { period: 'monthly', scope: { not: 'company' }, periodKey: key } });
  // PMs with office
  const pms = await prisma.pM.findMany();
  const officeByPm: Record<string, string> = {};
  for (const p of pms) officeByPm[p.name] = p.office;
  // sum per-PM by office
  const byOffice: Record<string, { booked: number; leads: number; closed: number; pmsFound: string[]; pmsNoOffice: string[] }> = {};
  let pmBookedTotal = 0;
  for (const h of pmRows) {
    pmBookedTotal += h.booked;
    const off = officeByPm[h.scope] || '(no office mapping)';
    if (!byOffice[off]) byOffice[off] = { booked: 0, leads: 0, closed: 0, pmsFound: [], pmsNoOffice: [] };
    byOffice[off].booked += h.booked; byOffice[off].leads += h.leads; byOffice[off].closed += h.closed;
    if (off === '(no office mapping)') byOffice[off].pmsNoOffice.push(h.scope); else byOffice[off].pmsFound.push(h.scope);
  }
  return NextResponse.json({
    month: key,
    companyBooked: company?.booked ?? null, companyLeads: company?.leads ?? null,
    perPmRowCount: pmRows.length, perPmBookedSum: pmBookedTotal,
    sumMatchesCompany: company ? Math.abs(pmBookedTotal - company.booked) < 1 : null,
    byOffice,
  });
}
