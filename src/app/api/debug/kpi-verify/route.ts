import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('key') || '2023-10';
  const company = await prisma.kpiHistory.findFirst({ where: { period: 'monthly', scope: 'company', periodKey: key } });
  const pmRows = await prisma.kpiHistory.findMany({ where: { period: 'monthly', scope: { not: 'company' }, periodKey: key }, orderBy: { booked: 'desc' } });
  return NextResponse.json({ month: key, companyBooked: company?.booked, perPm: pmRows.map(h => ({ pm: h.scope, booked: Math.round(h.booked), leads: h.leads })) });
}
