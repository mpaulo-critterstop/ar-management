// AR Benchmark — actual days-to-pay by service line (Pest / Wildlife / Insulation) at 30/60/90-day trailing.
// Weekly cadence, week = Saturday–Friday (keyed by the Friday week-end date).
//   ?token=critterstop2026               → read latest cached snapshot
//   ?token=critterstop2026&refresh=1     → recompute this week + cache (the weekly cron)
//   ?token=critterstop2026&week=2026-10-02 → read a specific week
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WILDLIFE_IDS = new Set([553, 716, 720, 501, 674, 479, 541, 542, 624, 510]);

function daysBetween(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86400000); }

function stats(arr: number[]) {
  if (!arr.length) return { n: 0, avg: null as number | null, median: null as number | null, min: null as number | null, max: null as number | null };
  const sorted = [...arr].sort((a, b) => a - b);
  const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { n: arr.length, avg: Math.round(avg * 10) / 10, median, min: sorted[0], max: sorted[sorted.length - 1] };
}

// The current pay-week's Friday (week runs Sat–Fri). Returns the most recent Friday on/before today.
function currentFriday(): Date {
  const d = new Date();
  const day = d.getUTCDay(); // 0 Sun .. 5 Fri .. 6 Sat
  const back = (day - 5 + 7) % 7; // days since last Friday
  const f = new Date(d); f.setUTCDate(d.getUTCDate() - back); f.setUTCHours(12, 0, 0, 0);
  return f;
}

async function computeWindows(asOf: Date = new Date()) {
  // Pull at the widest window (90d) ending at asOf + classify, then bucket per window.
  const since90 = new Date(asOf); since90.setDate(since90.getDate() - 90);
  const invoices = await prisma.invoice.findMany({
    where: { date: { gte: since90, lte: asOf } },
    select: { id: true, date: true, amount: true, paid: true, serviceId: true, payments: { select: { date: true, amount: true }, orderBy: { date: 'asc' } } },
  });
  const farJobs = await prisma.dispatchJob.findMany({ where: { hasFAR: true, invoiceId: { not: null } }, select: { invoiceId: true } });
  const insIds = new Set(farJobs.map(j => j.invoiceId));

  const now = asOf.getTime();
  const WINDOWS = [30, 60, 90];
  const result: any = {};
  for (const w of WINDOWS) result[`d${w}`] = { pest: [] as number[], wildlife: [] as number[], insulation: [] as number[] };

  for (const inv of invoices) {
    const amount = Number(inv.amount);
    if (amount <= 0) continue;
    // Fully-paid only counts if it happened on/before asOf (so past weeks reflect what was true then).
    let cum = 0, fullyPaid: Date | null = null;
    for (const p of inv.payments) {
      if (p.date.getTime() > now) continue; // ignore payments after the as-of date
      cum += Number(p.amount);
      if (cum >= amount - 0.01) { fullyPaid = p.date; break; }
    }
    if (!fullyPaid) continue;
    const d = daysBetween(inv.date, fullyPaid);
    if (d < 0 || d > 365) continue;
    const ageDays = Math.round((now - inv.date.getTime()) / 86400000);
    const sid = Number(inv.serviceId);
    const line = insIds.has(inv.id) ? 'insulation' : (WILDLIFE_IDS.has(sid) ? 'wildlife' : 'pest');
    for (const w of WINDOWS) if (ageDays <= w) result[`d${w}`][line].push(d);
  }

  const out: any = {};
  for (const w of WINDOWS) {
    out[`d${w}`] = {
      pest: stats(result[`d${w}`].pest),
      wildlife: stats(result[`d${w}`].wildlife),
      insulation: stats(result[`d${w}`].insulation),
    };
  }
  return out;
}

// Revenue by service line over a trailing number of WEEKS, + current actual AR (outstanding balance).
async function revenueAndAR(asOf: Date = new Date()) {
  const since = new Date(asOf); since.setDate(since.getDate() - 13 * 7); // widest window = 13 weeks
  const invoices = await prisma.invoice.findMany({
    where: { date: { gte: since, lte: asOf } },
    select: { id: true, date: true, amount: true, paid: true, serviceId: true },
  });
  const farJobs = await prisma.dispatchJob.findMany({ where: { hasFAR: true, invoiceId: { not: null } }, select: { invoiceId: true } });
  const insIds = new Set(farJobs.map(j => j.invoiceId));
  const now = asOf.getTime();
  const lineOf = (inv: any) => insIds.has(inv.id) ? 'insulation' : (WILDLIFE_IDS.has(Number(inv.serviceId)) ? 'wildlife' : 'pest');

  // Trailing revenue per line at the windows the formula uses: pest 4wk, wildlife 8wk, insulation 13wk.
  const rev = { pest4w: 0, wildlife8w: 0, insulation13w: 0, all13w: 0 };
  for (const inv of invoices) {
    const amt = Number(inv.amount);
    const ageDays = (now - inv.date.getTime()) / 86400000;
    const line = lineOf(inv);
    rev.all13w += amt; // term 4 uses all revenue, 13wk
    if (line === 'pest' && ageDays <= 28) rev.pest4w += amt;
    if (line === 'wildlife' && ageDays <= 56) rev.wildlife8w += amt;
    if (line === 'insulation' && ageDays <= 91) rev.insulation13w += amt;
  }

  // Actual AR. The stored `paid` field is authoritative (it includes credits/adjustments that aren't recorded
  // as Payment rows — the Payment table is incomplete, so summing it overstates AR). So for the CURRENT week
  // we use amount - paid. For PAST weeks we can't reliably reconstruct historical AR (paid field is point-in-
  // time "now", Payment rows are incomplete), so historical Actual AR is left null.
  const isCurrentWeek = Math.abs(now - Date.now()) < 7 * 86400000;
  let actualAR: number | null = null;
  if (isCurrentWeek) {
    const allInv = await prisma.invoice.findMany({ select: { amount: true, paid: true } });
    let ar = 0;
    for (const inv of allInv) { const bal = Number(inv.amount) - Number(inv.paid); if (bal > 0.01) ar += bal; }
    actualAR = Math.round(ar * 100) / 100;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return { rev: { pest4w: round(rev.pest4w), wildlife8w: round(rev.wildlife8w), insulation13w: round(rev.insulation13w), all13w: round(rev.all13w) }, actualAR };
}

// The AR benchmark formula (Chisam's structure), parameterized so we can run it with actual or theoretical inputs.
function benchmarkFormula(p: {
  revPest4w: number; revWild8w: number; revIns13w: number; revAll13w: number;
  pestWeightedDays: number;      // pest: weighted days-to-collect (e.g. 0.4*0 + 0.6*15 = 9)
  wildOpsDays: number; wildPayDays: number;  // wildlife: operational + payment
  insOpsDays: number; insPayDays: number;    // insulation: operational + payment
  financedPct: number; depositSplit: number; badDebtPct: number;
}) {
  const f = p.financedPct, dep = p.depositSplit, nonF = 1 - f;
  // Pest term: (weightedDays / 28) * rev
  const pest = (p.pestWeightedDays / 28) * p.revPest4w;
  // Wildlife term: ((nonF*dep*(ops+pay) + f*1*(ops+pay)) / 56) * rev
  const wTimeline = p.wildOpsDays + p.wildPayDays;
  const wildlife = ((nonF * dep * wTimeline + f * 1 * wTimeline) / 56) * p.revWild8w;
  // Insulation term: (... / 91) * rev
  const iTimeline = p.insOpsDays + p.insPayDays;
  const insulation = ((nonF * dep * iTimeline + f * 1 * iTimeline) / 91) * p.revIns13w;
  // Bad debt term: (badDebtPct * 90 / 91) * allRev
  const badDebt = (p.badDebtPct * 90 / 91) * p.revAll13w;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { pest: round(pest), wildlife: round(wildlife), insulation: round(insulation), badDebt: round(badDebt), total: round(pest + wildlife + insulation + badDebt) };
}

// Compute + store the benchmark for the week ending on `friday` (as-of that date). Reusable by refresh + backfill.
async function computeAndStoreWeek(friday: Date) {
  const weekKey = friday.toISOString().slice(0, 10);
  const monSat = new Date(friday); monSat.setUTCDate(friday.getUTCDate() - 6);
  const weekLabel = `Week of ${monSat.toISOString().slice(0, 10)} – ${weekKey} (Sat–Fri)`;

  const timing = await computeWindows(friday);
  const { rev, actualAR } = await revenueAndAR(friday);

  const actPestPay = timing.d30.pest.avg ?? 9;
  const actWildPay = timing.d60.wildlife.avg ?? 15;
  const actInsPay = timing.d90.insulation.avg ?? 15;
  const financedPct = 0.075, depositSplit = 0.5, badDebtPct = 0.01;
  const wildOps = 35, insOps = 75;

  const common = { revPest4w: rev.pest4w, revWild8w: rev.wildlife8w, revIns13w: rev.insulation13w, revAll13w: rev.all13w, financedPct, depositSplit, badDebtPct };
  const actualVersion = benchmarkFormula({ ...common, pestWeightedDays: actPestPay, wildOpsDays: wildOps, wildPayDays: actWildPay, insOpsDays: insOps, insPayDays: actInsPay });
  const chisamVersion = benchmarkFormula({ ...common, pestWeightedDays: 0.4 * 0 + 0.6 * 15, wildOpsDays: wildOps, wildPayDays: 15, insOpsDays: insOps, insPayDays: 15 });

  // Freeze Actual AR at first capture: if this week already has an actualAR stored, keep it (don't overwrite
  // with a live recompute — that would drift as payments come in after the Friday close). Everything else
  // (timing, revenue, benchmark) still refreshes.
  const existing = await prisma.arBenchmark.findUnique({ where: { weekKey } });
  const existingAR = (existing?.data as any)?.actualAR;
  const finalAR = (existingAR != null) ? existingAR : actualAR;

  const data = {
    ...timing, revenue: rev, actualAR: finalAR,
    benchmark: { actual: actualVersion, chisam: chisamVersion, inputs: { actPestPay, actWildPay, actInsPay, wildOps, insOps, financedPct, depositSplit, badDebtPct } },
  };
  const row = await prisma.arBenchmark.upsert({ where: { weekKey }, create: { weekKey, weekLabel, data }, update: { weekLabel, data, computedAt: new Date() } });
  return { weekKey, weekLabel, computedAt: row.computedAt, data };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Set a known Actual AR for a specific week (authoritative historical values provided manually).
  //   ?setAR=1&week=2026-08-14&ar=1309351
  if (sp.get('setAR') === '1') {
    const wk = sp.get('week'); const ar = parseFloat(sp.get('ar') || '');
    if (!wk || isNaN(ar)) return NextResponse.json({ error: 'week + ar required' }, { status: 400 });
    const row = await prisma.arBenchmark.findUnique({ where: { weekKey: wk } });
    if (!row) return NextResponse.json({ error: `week ${wk} not found` }, { status: 404 });
    const data: any = row.data;
    data.actualAR = ar;
    await prisma.arBenchmark.update({ where: { weekKey: wk }, data: { data } });
    return NextResponse.json({ ok: true, week: wk, actualAR: ar });
  }

  // Backfill the last N Sat–Fri weeks (default 8).
  if (sp.get('backfill')) {
    const n = Math.min(parseInt(sp.get('backfill') || '8') || 8, 26);
    const base = currentFriday();
    const done: string[] = [];
    for (let i = 0; i < n; i++) {
      const f = new Date(base); f.setUTCDate(base.getUTCDate() - i * 7); f.setUTCHours(12, 0, 0, 0);
      const r = await computeAndStoreWeek(f);
      done.push(r.weekKey);
    }
    return NextResponse.json({ backfilled: done.length, weeks: done });
  }

  const friday = currentFriday();
  const weekKey = sp.get('week') || friday.toISOString().slice(0, 10);
  const monSat = new Date(friday); monSat.setUTCDate(friday.getUTCDate() - 6);
  const weekLabel = `Week of ${monSat.toISOString().slice(0, 10)} – ${weekKey} (Sat–Fri)`;

  if (sp.get('refresh') === '1') {
    const r = await computeAndStoreWeek(currentFriday());
    return NextResponse.json({ refreshed: true, ...r });
  }

  // List available weeks (for the dropdown).
  if (sp.get('weeks') === '1') {
    const rows = await prisma.arBenchmark.findMany({ orderBy: { weekKey: 'desc' }, take: 104, select: { weekKey: true, weekLabel: true } });
    return NextResponse.json({ weeks: rows });
  }

  // Read: specific week, or latest.
  const row = sp.get('week')
    ? await prisma.arBenchmark.findUnique({ where: { weekKey } })
    : await prisma.arBenchmark.findFirst({ orderBy: { weekKey: 'desc' } });
  if (!row) return NextResponse.json({ note: 'No benchmark computed yet. Run with ?refresh=1.', weekKey });
  return NextResponse.json({ weekKey: row.weekKey, weekLabel: row.weekLabel, computedAt: row.computedAt, data: row.data });
}
