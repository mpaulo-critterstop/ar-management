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
  const dateField = searchParams.get('dateField') || 'all';

  const where: any = {};
  if (office) where.office = office;
  if (status) where.status = status;
  if (pmName) where.pmName = pmName;

  if (from || to) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (dateField === 'sold') {
      where.OR = [
        { invoice: { date: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } } },
        { upsellDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } },
      ];
    } else if (dateField === 'inspection') {
      where.inspectionDate = {};
      if (from) where.inspectionDate.gte = fromDate;
      if (to) where.inspectionDate.lte = toDate;
    } else if (dateField === 'upsell') {
      where.upsellDate = {};
      if (from) where.upsellDate.gte = fromDate;
      if (to) where.upsellDate.lte = toDate;
    } else {
      // 'all' - filter by inspection, sold, OR upsell date
      where.OR = [
        { inspectionDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } },
        { invoice: { date: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } } },
        { upsellDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } },
      ];
    }
  }

  const leads = await prisma.lead.findMany({
    where,
    include: {
      customer: { select: { name: true, serviceAddr: true } },
      invoice: { select: { amount: true, paid: true, status: true, externalId: true, date: true } },
      upsellInvoice: { select: { amount: true, paid: true, status: true, externalId: true, date: true } },
    },
    orderBy: { inspectionDate: 'desc' },
  });

  // KPI query - ignores status filter
  const kpiWhere = { ...where };
  delete kpiWhere.status;
  const kpiLeads = await prisma.lead.findMany({
    where: kpiWhere,
    include: { invoice: { select: { date: true } } },
  });

  const total = kpiLeads.length;
  const sold = kpiLeads.filter(l => l.status === 'SOLD').length;
  const inspected = kpiLeads.filter(l => l.status === 'INSPECTED').length;
  const pending = kpiLeads.filter(l => l.status === 'PENDING').length;
  const conversionRate = total > 0 ? (sold / total) * 100 : 0;

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const bookedRevenue = kpiLeads
    .filter(l => {
      if (l.status !== 'SOLD') return false;
      if (!fromDate && !toDate) return true;
      const invoiceDate = l.invoice?.date ? new Date(l.invoice.date) : null;
      if (!invoiceDate) return false;
      return (!fromDate || invoiceDate >= fromDate) && (!toDate || invoiceDate <= toDate);
    })
    .reduce((sum, l) => sum + (l.amount || 0), 0);

  const upsellRevenue = kpiLeads
    .filter(l => {
      if (!l.upsellAmount || !l.upsellDate) return false;
      if (!fromDate && !toDate) return true;
      const ud = new Date(l.upsellDate);
      return (!fromDate || ud >= fromDate) && (!toDate || ud <= toDate);
    })
    .reduce((sum, l) => sum + (l.upsellAmount || 0), 0);
  const avgSale = sold > 0 ? bookedRevenue / sold : 0;

  // KPIs by PM — upsellRevenue attributed to PM in upsellDate month
  const pmMap: Record<string, any> = {};
  for (const lead of leads) {
    const pm = lead.pmName || 'Unassigned';
    if (!pmMap[pm]) pmMap[pm] = { pmName: pm, total: 0, sold: 0, bookedRevenue: 0, upsellRevenue: 0 };
    pmMap[pm].total++;
    if (lead.status === 'SOLD') {
      pmMap[pm].sold++;
      pmMap[pm].bookedRevenue += lead.amount || 0;
    }
    if (lead.upsellAmount) {
      pmMap[pm].upsellRevenue += lead.upsellAmount;
    }
  }

  const pmKpis = Object.values(pmMap).map((pm: any) => ({
    ...pm,
    totalRevenue: pm.bookedRevenue + pm.upsellRevenue,
    conversionRate: pm.total > 0 ? (pm.sold / pm.total) * 100 : 0,
    avgSale: pm.sold > 0 ? pm.bookedRevenue / pm.sold : 0,
  })).sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);

  return NextResponse.json({
    leads,
    kpis: { total, sold, inspected, pending, conversionRate, bookedRevenue, upsellRevenue, totalRevenue: bookedRevenue + upsellRevenue, avgSale },
    pmKpis,
  });
}
