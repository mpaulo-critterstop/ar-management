// src/app/api/leads/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

// Service managers / non-PM staff who occasionally do wildlife inspections. Their leads DO appear in
// the Leads Tracker list, but they are excluded from the PM-KPI performance rollup (and, by having no
// commission plan, from commissions). Add names here to keep someone in the leads list but out of KPIs.
const KPI_EXCLUDED_PMS = new Set(['Kyle Oktay']);

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'leads')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const office = searchParams.get('office') || undefined;
  const status = searchParams.get('status') || undefined;
  const pmName = searchParams.get('pm') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  const dateField = searchParams.get('dateField') || 'all';

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to + 'T23:59:59.999Z') : undefined;

  // Date condition based on dateField
  const dateCond: any = {};
  if (fromDate || toDate) {
    if (dateField === 'sold') {
      dateCond.OR = [
        { invoice: { date: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } } },
        { upsellDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } },
      ];
    } else if (dateField === 'inspection') {
      dateCond.inspectionDate = { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) };
    } else if (dateField === 'upsell') {
      dateCond.upsellDate = { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) };
    } else {
      dateCond.OR = [
        { inspectionDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } },
        { invoice: { date: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } } },
        { upsellDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } },
      ];
    }
  }

  const baseWhere: any = {};
  if (office) baseWhere.office = office;
  if (pmName) baseWhere.pmName = pmName;

  // Table query date condition:
  // All filter → inspection date in range
  // Sold filter → invoice date OR upsell date in range
  const tableDateCond: any = {};
  if (fromDate || toDate) {
    if (dateField === 'sold') {
      tableDateCond.OR = [
        { invoice: { date: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } } },
        { upsellDate: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } },
      ];
    } else {
      tableDateCond.inspectionDate = { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) };
    }
  }

  // Main leads query — includes status + table date filters for the table
  const where: any = { ...baseWhere, ...tableDateCond };
  if (status) where.status = status;

  const leads = await prisma.lead.findMany({
    where,
    include: {
      customer: { select: { name: true, serviceAddr: true } },
      invoice: { select: { amount: true, paid: true, status: true, externalId: true, date: true } },
      upsellInvoice: { select: { amount: true, paid: true, status: true, externalId: true, date: true } },
    },
    orderBy: { inspectionDate: 'desc' },
  });

  // KPI query — same date filter but NO status filter
  const kpiWhere: any = { ...baseWhere, ...dateCond };
  const kpiLeads = await prisma.lead.findMany({
    where: kpiWhere,
    include: { invoice: { select: { date: true } } },
  });

  // Total/conversion counts — always use inspection date range so INSPECTED leads are included
  const totalWhere: any = { ...baseWhere };
  if (fromDate || toDate) {
    totalWhere.inspectionDate = {
      ...(fromDate && { gte: fromDate }),
      ...(toDate && { lte: toDate }),
    };
  }
  const totalLeads = await prisma.lead.findMany({
    where: totalWhere,
    select: { status: true },
  });

  const total = totalLeads.length;
  const soldCount = totalLeads.filter((l: any) => l.status === 'SOLD').length;
  const inspected = totalLeads.filter((l: any) => l.status === 'INSPECTED').length;
  const pending = totalLeads.filter((l: any) => l.status === 'PENDING').length;
  const conversionRate = total > 0 ? (soldCount / total) * 100 : 0;

  // bookedRevenue: SOLD leads where invoice date is in range
  const bookedRevenue = kpiLeads
    .filter((l: any) => {
      if (l.status !== 'SOLD') return false;
      if (!fromDate && !toDate) return true;
      const invoiceDate = l.invoice?.date ? new Date(l.invoice.date) : null;
      if (!invoiceDate) return false;
      return (!fromDate || invoiceDate >= fromDate) && (!toDate || invoiceDate <= toDate);
    })
    .reduce((sum: number, l: any) => sum + (l.amount || 0), 0);

  // upsellRevenue: leads where upsellDate is in range
  const upsellRevenue = kpiLeads
    .filter((l: any) => {
      if (!l.upsellAmount || !l.upsellDate) return false;
      if (!fromDate && !toDate) return true;
      const ud = new Date(l.upsellDate);
      return (!fromDate || ud >= fromDate) && (!toDate || ud <= toDate);
    })
    .reduce((sum: number, l: any) => sum + (l.upsellAmount || 0), 0);

  const avgSale = soldCount > 0 ? bookedRevenue / soldCount : 0;

  // KPIs by PM
  const pmMap: Record<string, any> = {};
  for (const lead of kpiLeads) {
    const pm = (lead as any).pmName || 'Unassigned';
    if (KPI_EXCLUDED_PMS.has(pm)) continue; // service managers: in leads list, not in PM-KPI rollup
    if (!pmMap[pm]) pmMap[pm] = { pmName: pm, total: 0, sold: 0, bookedRevenue: 0, upsellRevenue: 0 };
    pmMap[pm].total++;
    if ((lead as any).status === 'SOLD') {
      pmMap[pm].sold++;
      // Only count if invoice date in range
      const invoiceDate = (lead as any).invoice?.date ? new Date((lead as any).invoice.date) : null;
      const inRange = !fromDate && !toDate || (invoiceDate && (!fromDate || invoiceDate >= fromDate) && (!toDate || invoiceDate <= toDate));
      if (inRange) pmMap[pm].bookedRevenue += (lead as any).amount || 0;
    }
    if ((lead as any).upsellAmount && (lead as any).upsellDate) {
      const ud = new Date((lead as any).upsellDate);
      const inRange = !fromDate && !toDate || ((!fromDate || ud >= fromDate) && (!toDate || ud <= toDate));
      if (inRange) pmMap[pm].upsellRevenue += (lead as any).upsellAmount || 0;
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
    kpis: { total, sold: soldCount, inspected, pending, conversionRate, bookedRevenue, upsellRevenue, totalRevenue: bookedRevenue + upsellRevenue, avgSale },
    pmKpis,
  });
}
