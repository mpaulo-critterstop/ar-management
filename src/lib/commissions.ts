import { prisma } from '@/lib/prisma';

// ─── Types ────────────────────────────────────────────────────────────────────
export type CommissionMethod = 'abr_tiered' | 'abr_adrian' | 'lead_bucket';

export interface AbrTiers {
  floor: number;                                   // revenue below this earns 0
  breaks: { upTo: number | null; rate: number }[]; // marginal tiers; upTo null = no cap
}
export interface BucketTiers {
  buckets: { floor: number; cap: number | null; rate: number }[]; // by revenue-per-lead
}

// ─── Month helpers ──────────────────────────────────────────────────────────────
export function monthStart(year: number, month1to12: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, 1, 0, 0, 0));
}
export function monthEnd(year: number, month1to12: number): Date {
  return new Date(Date.UTC(year, month1to12, 0, 23, 59, 59, 999));
}

// ─── Revenue per PM per month (matches KPIs totalRevenue = booked + upsell) ──────
// Booked: SOLD lead.amount where invoice.date in month.  Upsell: upsellAmount where upsellDate in month.
// Also returns lead count (for the lead_bucket method denominator).
export async function pmRevenueForMonth(pmName: string, start: Date, end: Date): Promise<{
  bookedRevenue: number; upsellRevenue: number; totalRevenue: number; leadCount: number;
}> {
  const leads = await prisma.lead.findMany({
    where: {
      pmName,
      OR: [
        { status: 'SOLD', invoice: { date: { gte: start, lte: end } } },
        { upsellDate: { gte: start, lte: end } },
      ],
    },
    include: { invoice: { select: { date: true } } },
  });

  let booked = 0, upsell = 0, leadCount = 0;
  for (const l of leads as any[]) {
    const invDate = l.invoice?.date ? new Date(l.invoice.date) : null;
    if (l.status === 'SOLD' && invDate && invDate >= start && invDate <= end) {
      booked += l.amount || 0;
      leadCount++;
    }
    if (l.upsellAmount && l.upsellDate) {
      const ud = new Date(l.upsellDate);
      if (ud >= start && ud <= end) upsell += l.upsellAmount || 0;
    }
  }
  return { bookedRevenue: booked, upsellRevenue: upsell, totalRevenue: booked + upsell, leadCount };
}

// ─── Wildlife commission by method ──────────────────────────────────────────────
export function wildlifeCommission(method: CommissionMethod, tiers: any, adjustedRevenue: number, leadCount: number): number {
  if (method === 'abr_tiered' || method === 'abr_adrian') {
    const t = tiers as AbrTiers;
    const floor = t.floor ?? 0;
    let comm = 0, prev = floor;
    for (const b of t.breaks) {
      const cap = b.upTo === null ? Infinity : b.upTo;
      const amountInTier = Math.max(0, Math.min(adjustedRevenue, cap) - prev);
      comm += amountInTier * b.rate;
      prev = cap;
      if (adjustedRevenue <= cap) break;
    }
    return comm;
  }
  if (method === 'lead_bucket') {
    const t = tiers as BucketTiers;
    if (!leadCount || leadCount <= 0) return 0;
    const revPerLead = adjustedRevenue / leadCount;
    let comm = 0;
    for (const b of t.buckets) {
      const cap = b.cap === null ? Infinity : b.cap;
      const perLeadInBucket = Math.max(0, Math.min(revPerLead, cap) - b.floor);
      comm += perLeadInBucket * leadCount * b.rate;
    }
    return comm;
  }
  return 0;
}

// ─── The plan in effect for a PM at a given month ───────────────────────────────
export async function planFor(pmName: string, month: Date) {
  const plans = await prisma.commissionPlan.findMany({
    where: {
      pmName,
      active: true,
      effectiveFrom: { lte: month },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: month } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  return plans[0] || null;
}

// ─── Full commission breakdown for one PM for one month ─────────────────────────
// Live revenue + pre-period delta (vs finalized snapshots of prior months) + plan → total.
export async function computeCommission(pmName: string, year: number, month1to12: number) {
  const start = monthStart(year, month1to12);
  const end = monthEnd(year, month1to12);

  const rev = await pmRevenueForMonth(pmName, start, end);
  const plan = await planFor(pmName, start);

  // Pre-period delta: reconcile ONLY the immediately-preceding month against its as-paid baseline.
  // (The spreadsheet reconciled month-to-month, not against all history — and old months' live
  //  revenue isn't a meaningful baseline. Baseline source: CommissionMonth snapshot if finalized,
  //  else CommissionHistory frozen figure — e.g. June 2026 is July's baseline via history.)
  const prevMonthDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const prevKey = prevMonthDate.toISOString().slice(0, 7);

  let prevBaseline: number | null = null;
  const snap = await prisma.commissionMonth.findUnique({
    where: { pmName_month: { pmName, month: prevMonthDate } },
  });
  if (snap?.finalized && snap.asPaidTotalRevenue != null) {
    prevBaseline = snap.asPaidTotalRevenue;
  } else {
    const hist = await prisma.commissionHistory.findUnique({
      where: { pmName_month: { pmName, month: prevMonthDate } },
    });
    if (hist?.bookedRevenue != null) prevBaseline = hist.bookedRevenue;
  }

  let prePeriodDelta = 0;
  const deltaDetail: { month: string; asPaid: number; liveNow: number; delta: number }[] = [];
  if (prevBaseline !== null) {
    const ps = new Date(Date.UTC(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth(), 1, 0, 0, 0));
    const pe = new Date(Date.UTC(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const liveNow = (await pmRevenueForMonth(pmName, ps, pe)).totalRevenue;
    const d = liveNow - prevBaseline;
    if (Math.abs(d) > 0.005) {
      prePeriodDelta = d;
      deltaDetail.push({ month: prevKey, asPaid: prevBaseline, liveNow, delta: d });
    }
  }

  const adjustedRevenue = rev.totalRevenue + prePeriodDelta;
  const wildlife = plan ? wildlifeCommission(plan.method as CommissionMethod, plan.tiers, adjustedRevenue, rev.leadCount) : 0;

  // Manual inputs from the CommissionMonth row (if any).
  const record = await prisma.commissionMonth.findUnique({ where: { pmName_month: { pmName, month: start } } });
  const pestControlComm = record?.pestControlComm ?? 0;
  const otherAdjustment = record?.otherAdjustment ?? 0;

  const calculatedCommission = wildlife + pestControlComm;
  const totalCommission = calculatedCommission + otherAdjustment;

  return {
    pmName, year, month: month1to12,
    monthKey: start.toISOString().slice(0, 7),
    plan: plan ? { method: plan.method, tiers: plan.tiers } : null,
    bookedRevenue: rev.bookedRevenue,
    upsellRevenue: rev.upsellRevenue,
    totalRevenue: rev.totalRevenue,
    leadCount: rev.leadCount,
    prePeriodDelta,
    deltaDetail,
    adjustedRevenue,
    wildlifeCommission: wildlife,
    pestControlComm,
    otherAdjustment,
    otherAdjNote: record?.otherAdjNote ?? null,
    calculatedCommission,
    totalCommission,
    finalized: record?.finalized ?? false,
    finalizedAt: record?.finalizedAt ?? null,
    asPaidTotalRevenue: record?.asPaidTotalRevenue ?? null,
  };
}
