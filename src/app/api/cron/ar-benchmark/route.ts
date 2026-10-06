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

async function computeWindows() {
  // Pull once at the widest window (90d) + classify, then bucket per window.
  const since90 = new Date(); since90.setDate(since90.getDate() - 90);
  const invoices = await prisma.invoice.findMany({
    where: { date: { gte: since90 } },
    select: { id: true, date: true, amount: true, paid: true, serviceId: true, payments: { select: { date: true, amount: true }, orderBy: { date: 'asc' } } },
  });
  const farJobs = await prisma.dispatchJob.findMany({ where: { hasFAR: true, invoiceId: { not: null } }, select: { invoiceId: true } });
  const insIds = new Set(farJobs.map(j => j.invoiceId));

  const now = Date.now();
  const WINDOWS = [30, 60, 90];
  const result: any = {};
  for (const w of WINDOWS) result[`d${w}`] = { pest: [] as number[], wildlife: [] as number[], insulation: [] as number[] };

  for (const inv of invoices) {
    const amount = Number(inv.amount), paid = Number(inv.paid);
    if (amount <= 0 || paid < amount - 0.01) continue;
    let cum = 0, fullyPaid: Date | null = null;
    for (const p of inv.payments) { cum += Number(p.amount); if (cum >= amount - 0.01) { fullyPaid = p.date; break; } }
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
async function revenueAndAR() {
  const since = new Date(); since.setDate(since.getDate() - 13 * 7); // widest window = 13 weeks
  const invoices = await prisma.invoice.findMany({
    where: { date: { gte: since } },
    select: { id: true, date: true, amount: true, paid: true, serviceId: true },
  });
  const farJobs = await prisma.dispatchJob.findMany({ where: { hasFAR: true, invoiceId: { not: null } }, select: { invoiceId: true } });
  const insIds = new Set(farJobs.map(j => j.invoiceId));
  const now = Date.now();
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

  // Actual current AR = sum of outstanding (amount - paid) across all not-fully-paid invoices (all time).
  const openAgg = await prisma.invoice.findMany({ where: {}, select: { amount: true, paid: true } });
  let actualAR = 0;
  for (const inv of openAgg) { const bal = Number(inv.amount) - Number(inv.paid); if (bal > 0.01) actualAR += bal; }

  const round = (n: number) => Math.round(n * 100) / 100;
  return { rev: { pest4w: round(rev.pest4w), wildlife8w: round(rev.wildlife8w), insulation13w: round(rev.insulation13w), all13w: round(rev.all13w) }, actualAR: round(actualAR) };
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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const friday = currentFriday();
  const weekKey = sp.get('week') || friday.toISOString().slice(0, 10);
  const monSat = new Date(friday); monSat.setUTCDate(friday.getUTCDate() - 6);
  const weekLabel = `Week of ${monSat.toISOString().slice(0, 10)} – ${weekKey} (Sat–Fri)`;

  if (sp.get('refresh') === '1') {
    const timing = await computeWindows();
    const { rev, actualAR } = await revenueAndAR();

    // Actual payment timing (from the 90-day window — most reliable), used for the "actuals-based" benchmark.
    const actPestPay = timing.d90.pest.avg ?? 9;
    const actWildPay = timing.d90.wildlife.avg ?? 15;
    const actInsPay = timing.d90.insulation.avg ?? 15;

    // Chisam's structural assumptions (his current formula's values).
    const financedPct = 0.075, depositSplit = 0.5, badDebtPct = 0.01;
    const wildOps = 35, insOps = 75; // his operational-timeline assumptions (kept; payment timing is what we update)

    // Version A — ACTUALS: real payment timing from the Hub, same ops timelines + structural assumptions.
    const actualVersion = benchmarkFormula({
      revPest4w: rev.pest4w, revWild8w: rev.wildlife8w, revIns13w: rev.insulation13w, revAll13w: rev.all13w,
      pestWeightedDays: actPestPay,            // actual avg pest days-to-pay (replaces 0.4*0+0.6*15=9)
      wildOpsDays: wildOps, wildPayDays: actWildPay,   // actual wildlife payment timing (replaces +15)
      insOpsDays: insOps, insPayDays: actInsPay,       // actual insulation payment timing (replaces +15)
      financedPct, depositSplit, badDebtPct,
    });

    // Version B — CHISAM'S: his exact theoretical values.
    const chisamVersion = benchmarkFormula({
      revPest4w: rev.pest4w, revWild8w: rev.wildlife8w, revIns13w: rev.insulation13w, revAll13w: rev.all13w,
      pestWeightedDays: 0.4 * 0 + 0.6 * 15,    // = 9
      wildOpsDays: wildOps, wildPayDays: 15,
      insOpsDays: insOps, insPayDays: 15,
      financedPct, depositSplit, badDebtPct,
    });

    const data = {
      ...timing,
      revenue: rev,
      actualAR,
      benchmark: {
        actual: actualVersion,
        chisam: chisamVersion,
        inputs: { actPestPay, actWildPay, actInsPay, wildOps, insOps, financedPct, depositSplit, badDebtPct },
      },
    };
    const row = await prisma.arBenchmark.upsert({
      where: { weekKey }, create: { weekKey, weekLabel, data }, update: { weekLabel, data, computedAt: new Date() },
    });
    return NextResponse.json({ refreshed: true, weekKey, weekLabel, computedAt: row.computedAt, data });
  }

  // Read: specific week, or latest.
  const row = sp.get('week')
    ? await prisma.arBenchmark.findUnique({ where: { weekKey } })
    : await prisma.arBenchmark.findFirst({ orderBy: { weekKey: 'desc' } });
  if (!row) return NextResponse.json({ note: 'No benchmark computed yet. Run with ?refresh=1.', weekKey });
  return NextResponse.json({ weekKey: row.weekKey, weekLabel: row.weekLabel, computedAt: row.computedAt, data: row.data });
}
