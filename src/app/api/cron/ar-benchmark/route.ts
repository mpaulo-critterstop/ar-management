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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const friday = currentFriday();
  const weekKey = sp.get('week') || friday.toISOString().slice(0, 10);
  const monSat = new Date(friday); monSat.setUTCDate(friday.getUTCDate() - 6);
  const weekLabel = `Week of ${monSat.toISOString().slice(0, 10)} – ${weekKey} (Sat–Fri)`;

  if (sp.get('refresh') === '1') {
    const data = await computeWindows();
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
