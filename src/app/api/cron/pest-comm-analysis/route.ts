// ONE-TIME ANALYSIS (not a scheduled cron). Models the proposed UNIFIED pest commission structure against
// real historical PM pest sales (Dec 2025+), to tune tiers so total payout is "slightly higher than current."
//
// Chisam's redesign goal: combine Rodent Bundle + Pest Control (GPC) into ONE commission on monthly PM
// revenue, tiered by $ buckets (fixing the flaw where count-tiered GPC rewards cheap-standalone over high-CV
// bundles). Termite stays as-is (its own brackets). Only COMPLETED sales earn commission (same as live rules).
//
//   /api/cron/pest-comm-analysis?token=critterstop2026
//   &from=2025-12            → earliest commissionMonth to include (default 2025-12)
//   &byMonth=1               → also return per-PM-per-month detail
//
// Returns: current-structure total, each candidate proposal's total, and the % change vs current — so we can
// pick/tune the tiers that land slightly positive.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { perSaleRate, gpcRateForIndex, PestCommCategory } from '@/lib/pestCommission';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// A tiered structure on monthly combined (GPC+Rodent) revenue. Each tier: revenue in [min,max) → rate.
// MARGINAL by default (like current GPC) OR flat (whole amount at the top bracket's rate) — we test both.
type Tier = { upTo: number | null; rate: number }; // upTo=null means "and above"

function tieredMarginal(revenue: number, tiers: Tier[]): number {
  let comm = 0, prev = 0;
  for (const t of tiers) {
    const cap = t.upTo ?? Infinity;
    if (revenue > prev) {
      const slice = Math.min(revenue, cap) - prev;
      if (slice > 0) comm += slice * t.rate;
      prev = cap;
    } else break;
  }
  return comm;
}
function tieredFlat(revenue: number, tiers: Tier[]): number {
  for (const t of tiers) { if (revenue <= (t.upTo ?? Infinity)) return revenue * t.rate; }
  return revenue * tiers[tiers.length - 1].rate;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026' && sp.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const from = sp.get('from') || '2025-12';
  const wantMonth = sp.get('byMonth') === '1';

  const sales = await prisma.pestSale.findMany({
    where: { sellerType: 'pm', initialDone: true, commissionMonth: { not: null, gte: from } },
    select: { pmName: true, category: true, contractValue: true, commissionMonth: true },
  });

  // Group by PM+month.
  const groups = new Map<string, { pm: string; month: string; gpc: number[]; rodent: number[]; termite: number[] }>();
  for (const s of sales) {
    if (!s.pmName || !s.commissionMonth) continue;
    const k = `${s.pmName}||${s.commissionMonth}`;
    if (!groups.has(k)) groups.set(k, { pm: s.pmName, month: s.commissionMonth, gpc: [], rodent: [], termite: [] });
    const g = groups.get(k)!;
    const cv = s.contractValue || 0;
    if (s.category === 'Pest Control') g.gpc.push(cv);
    else if (s.category === 'Rodent Bundle') g.rodent.push(cv);
    else if (s.category === 'Termite') g.termite.push(cv);
    // (other flat categories exist but aren't part of the GPC+Rodent unification; left out of this model)
  }

  // ---- CURRENT structure ----
  function currentPestRodentComm(g: { gpc: number[]; rodent: number[] }): number {
    // GPC marginal by count (ordered — we only have CVs, order within month doesn't change the marginal sum
    // since each sale's rate depends on its index; we approximate by the natural array order which matches
    // completion-date insertion closely enough for aggregate analysis).
    let c = 0;
    g.gpc.forEach((cv, i) => { c += cv * gpcRateForIndex(i + 1); });
    for (const cv of g.rodent) c += cv * perSaleRate('Rodent Bundle' as PestCommCategory, cv);
    return c;
  }

  // ---- PROPOSED candidates (combine GPC+Rodent into one monthly-revenue tiered commission) ----
  // Chisam's rough idea: 20% ≤$5K, 30% $5–10K, 40% $10K+. We test his idea (marginal + flat) plus a couple
  // of tuned variants, and report which lands slightly above current.
  const candidates: { name: string; mode: 'marginal' | 'flat'; tiers: Tier[] }[] = [
    { name: 'Chisam idea (marginal) 20/30/40', mode: 'marginal', tiers: [{ upTo: 5000, rate: 0.20 }, { upTo: 10000, rate: 0.30 }, { upTo: null, rate: 0.40 }] },
    { name: 'Chisam idea (flat) 20/30/40',     mode: 'flat',     tiers: [{ upTo: 5000, rate: 0.20 }, { upTo: 10000, rate: 0.30 }, { upTo: null, rate: 0.40 }] },
    { name: 'Variant A (marginal) 25/35/45',   mode: 'marginal', tiers: [{ upTo: 5000, rate: 0.25 }, { upTo: 10000, rate: 0.35 }, { upTo: null, rate: 0.45 }] },
    { name: 'Variant B (marginal) 30/40/50',   mode: 'marginal', tiers: [{ upTo: 5000, rate: 0.30 }, { upTo: 10000, rate: 0.40 }, { upTo: null, rate: 0.50 }] },
    { name: 'Variant C (flat) 30/40/50',       mode: 'flat',     tiers: [{ upTo: 5000, rate: 0.30 }, { upTo: 10000, rate: 0.40 }, { upTo: null, rate: 0.50 }] },
  ];

  let currentTotal = 0;
  const propTotals: Record<string, number> = {};
  candidates.forEach(c => propTotals[c.name] = 0);
  let combinedRevenueTotal = 0, pmMonthCount = 0;
  const byMonth: any[] = [];
  const revenueBuckets = { '0-5k': 0, '5-10k': 0, '10k+': 0 }; // how many PM-months land in each bucket

  for (const g of groups.values()) {
    const combinedRev = [...g.gpc, ...g.rodent].reduce((a, b) => a + b, 0);
    if (combinedRev === 0) continue;
    combinedRevenueTotal += combinedRev;
    pmMonthCount++;
    if (combinedRev <= 5000) revenueBuckets['0-5k']++; else if (combinedRev <= 10000) revenueBuckets['5-10k']++; else revenueBuckets['10k+']++;

    const cur = currentPestRodentComm(g);
    currentTotal += cur;
    const row: any = { pm: g.pm, month: g.month, combinedRevenue: Math.round(combinedRev), current: Math.round(cur) };
    for (const c of candidates) {
      const amt = c.mode === 'marginal' ? tieredMarginal(combinedRev, c.tiers) : tieredFlat(combinedRev, c.tiers);
      propTotals[c.name] += amt;
      row[c.name] = Math.round(amt);
    }
    if (wantMonth) byMonth.push(row);
  }

  const summary = {
    period: `${from} → latest`,
    pmMonthsAnalyzed: pmMonthCount,
    totalCombinedRevenue: Math.round(combinedRevenueTotal),
    revenueBucketDistribution: revenueBuckets,
    currentStructureTotalPaid: Math.round(currentTotal),
    proposals: candidates.map(c => ({
      name: c.name,
      totalPaid: Math.round(propTotals[c.name]),
      vsCurrentDollar: Math.round(propTotals[c.name] - currentTotal),
      vsCurrentPct: currentTotal ? Math.round((propTotals[c.name] / currentTotal - 1) * 1000) / 10 : null,
    })),
    note: 'Combines GPC + Rodent Bundle into one monthly-revenue-tiered commission. Termite excluded here (stays as-is). "Slightly higher than current" = pick the proposal with a small positive vsCurrentPct. Marginal = each $ slice taxed at its tier (recommended, smoother); flat = whole amount at the bracket rate (cliff edges).',
  };

  return NextResponse.json({ ...summary, byMonth: wantMonth ? byMonth.sort((a, b) => b.combinedRevenue - a.combinedRevenue).slice(0, 300) : undefined });
}
