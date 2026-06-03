// src/app/api/leads/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const office = searchParams.get('office') || undefined;
  const status = searchParams.get('status') || undefined;
  const pmName = searchParams.get('pm') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  const where: any = {};
  if (office) where.office = office;
  if (status) where.status = status;
  if (pmName) where.pmName = pmName;
 const dateField = searchParams.get('dateField') || 'all';
  if (from || to) {
    if (dateField === 'sold') {
      where.invoice = { date: {} };
      if (from) where.invoice.date.gte = new Date(from);
      if (to) where.invoice.date.lte = new Date(to);
    } else if (dateField === 'inspection') {
      where.inspectionDate = {};
      if (from) where.inspectionDate.gte = new Date(from);
      if (to) where.inspectionDate.lte = new Date(to);
    } else {
      // 'all' - filter by either inspection date OR sold date within range
      const fromDate = from ? new Date(from) : undefined;
      const toDate = to ? new Date(to) : undefined;
      where.OR = [
        { inspectionDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } },
        { invoice: { date: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } } },
      ];
    }
  }

  const leads = await prisma.lead.findMany({
    where,
    include: {
      customer: { select: { name: true, serviceAddr: true } },
      invoice: { select: { amount: true, paid: true, status: true, externalId: true, date: true } },
    },
    orderBy: { inspectionDate: 'desc' },
  });

  // Calculate KPIs
  const total = leads.length;
  const sold = leads.filter(l => l.status === 'SOLD').length;
  const inspected = leads.filter(l => l.status === 'INSPECTED').length;
  const pending = leads.filter(l => l.status === 'PENDING').length;
  const conversionRate = total > 0 ? (sold / total) * 100 : 0;
  const bookedRevenue = leads
    .filter(l => l.status === 'SOLD')
    .reduce((sum, l) => sum + (l.amount || 0), 0);
  const avgSale = sold > 0 ? bookedRevenue / sold : 0;

  // KPIs by PM
  const pmMap: Record<string, any> = {};
  for (const lead of leads) {
    const pm = lead.pmName || 'Unassigned';
    if (!pmMap[pm]) pmMap[pm] = { pmName: pm, total: 0, sold: 0, bookedRevenue: 0 };
    pmMap[pm].total++;
    if (lead.status === 'SOLD') {
      pmMap[pm].sold++;
      pmMap[pm].bookedRevenue += lead.amount || 0;
    }
  }

  const pmKpis = Object.values(pmMap).map((pm: any) => ({
    ...pm,
    conversionRate: pm.total > 0 ? (pm.sold / pm.total) * 100 : 0,
    avgSale: pm.sold > 0 ? pm.bookedRevenue / pm.sold : 0,
  })).sort((a: any, b: any) => b.bookedRevenue - a.bookedRevenue);

  return NextResponse.json({
    leads,
    kpis: { total, sold, inspected, pending, conversionRate, bookedRevenue, avgSale },
    pmKpis,
  });
}
