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

// Canonical lead_bucket tiers — single source of truth. Used as a fallback when a PM's
// commission plan doesn't cover an older month (e.g. plan effectiveFrom is 2026 but the PM
// has 2025 history), so finalized months still render the per-bucket breakdown.
export const DEFAULT_LEAD_BUCKET_TIERS: BucketTiers = {
  buckets: [
    { floor: 700, cap: 1000, rate: 0.08 },
    { floor: 1000, cap: 1200, rate: 0.10 },
    { floor: 1200, cap: 1400, rate: 0.12 },
    { floor: 1400, cap: null, rate: 0.14 },
  ],
};

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

  let booked = 0, upsell = 0;
  for (const l of leads as any[]) {
    const invDate = l.invoice?.date ? new Date(l.invoice.date) : null;
    if (l.status === 'SOLD' && invDate && invDate >= start && invDate <= end) {
      booked += l.amount || 0;
    }
    if (l.upsellAmount && l.upsellDate) {
      const ud = new Date(l.upsellDate);
      if (ud >= start && ud <= end) upsell += l.upsellAmount || 0;
    }
  }

  // leadCount = TOTAL leads worked that month (by inspectionDate), NOT just sold leads.
  // This is the denominator for the lead_bucket rev-per-lead metric (booked revenue spread
  // across every lead worked, matching the FPEM sheet's "# of Leads").
  const leadCount = await prisma.lead.count({
    where: { pmName, inspectionDate: { gte: start, lte: end } },
  });

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
    // Excel formula: find the SINGLE bucket the rev-per-lead falls into, then commission =
    // (revPerLead − floorOfFirstBucket) × leadCount × thatBucket'sRate.
    // (NOT cumulative tier-stacking.) Floor for the "amount above" is the lowest bucket floor (700).
    const baseFloor = t.buckets[0]?.floor ?? 0;
    if (revPerLead < baseFloor) return 0;
    const bucket = t.buckets.find(b => {
      const cap = b.cap === null ? Infinity : b.cap;
      return revPerLead >= b.floor && revPerLead < cap;
    }) ?? t.buckets[t.buckets.length - 1];
    return (revPerLead - baseFloor) * leadCount * bucket.rate;
  }
  return 0;
}

// Per-bucket breakdown for display: the commission lands entirely in the ONE bucket the rev-per-lead
// falls into (matching the Excel). Other buckets show 0.
export function bucketBreakdown(tiers: any, adjustedRevenue: number, leadCount: number): { label: string; rate: number; amount: number }[] {
  const t = tiers as BucketTiers;
  const base = (t?.buckets ?? []).map(b => ({ label: bucketLabel(b), rate: b.rate, amount: 0 }));
  if (!leadCount || leadCount <= 0) return base;
  const revPerLead = adjustedRevenue / leadCount;
  const baseFloor = t.buckets[0]?.floor ?? 0;
  if (revPerLead < baseFloor) return base;
  const idx = t.buckets.findIndex(b => {
    const cap = b.cap === null ? Infinity : b.cap;
    return revPerLead >= b.floor && revPerLead < cap;
  });
  const useIdx = idx === -1 ? t.buckets.length - 1 : idx;
  base[useIdx].amount = (revPerLead - baseFloor) * leadCount * t.buckets[useIdx].rate;
  return base;
}

function bucketLabel(b: { floor: number; cap: number | null; rate: number }): string {
  const money = (n: number) => '$' + n.toLocaleString('en-US');
  const range = b.cap === null ? `>${money(b.floor)}` : `${money(b.floor)} - ${money(b.cap)}`;
  return `${range} (${(b.rate * 100).toFixed(0)}%)`;
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

  // Lead-bucket display extras (null for non-bucket plans).
  const isBucket = plan?.method === 'lead_bucket';
  const revPerLead = (isBucket && rev.leadCount > 0) ? rev.bookedRevenue / rev.leadCount : null;
  const adjustedRevPerLead = (isBucket && rev.leadCount > 0) ? adjustedRevenue / rev.leadCount : null;
  const buckets = isBucket ? bucketBreakdown(plan!.tiers, adjustedRevenue, rev.leadCount) : null;

  return {
    pmName, year, month: month1to12,
    monthKey: start.toISOString().slice(0, 7),
    plan: plan ? { method: plan.method, tiers: plan.tiers } : null,
    bookedRevenue: rev.bookedRevenue,
    upsellRevenue: rev.upsellRevenue,
    totalRevenue: rev.totalRevenue,
    leadCount: rev.leadCount,
    revPerLead,
    adjustedRevPerLead,
    buckets,
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
