// AR Benchmark input analysis — actual payment timing by service line, from Hub data.
// X = Pest Control: invoice.date -> fully-paid date (pest invoices are due the service day).
// Also exposes wildlife + insulation timing scaffolding (Y/Z) off DispatchJob + invoices.
//   /api/cron/payment-timing?token=critterstop2026&days=60   (trailing window, default 60)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const WILDLIFE_IDS = new Set([553, 716, 720, 501, 674, 479, 541, 542, 624, 510]);
const INSULATION_IDS = new Set([624, 542, 541, 479, 1073, 674]); // FAR / insulation service types

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const days = parseInt(sp.get('days') || '60');
  const office = sp.get('office');
  const since = new Date(); since.setDate(since.getDate() - days);

  // Pull invoices in the trailing window that are fully paid, with their payments.
  const invoices = await prisma.invoice.findMany({
    where: {
      date: { gte: since },
      ...(office && office !== 'All' ? { office: { equals: office, mode: 'insensitive' } } : {}),
    },
    select: {
      id: true, date: true, amount: true, paid: true, serviceId: true, serviceType: true, office: true, status: true,
      payments: { select: { date: true, amount: true }, orderBy: { date: 'asc' } },
    },
  });

  // Classify + compute days-to-pay for fully-paid invoices.
  const buckets: Record<string, number[]> = { pest: [], wildlife: [], insulation: [] };
  let considered = 0, paidCount = 0;

  for (const inv of invoices) {
    considered++;
    const amount = Number(inv.amount);
    const paid = Number(inv.paid);
    if (amount <= 0) continue;
    if (paid < amount - 0.01) continue; // only fully-paid invoices have a clean "time to pay"
    paidCount++;

    // The date it became fully paid = the payment that pushed cumulative paid >= amount.
    let cum = 0; let fullyPaidDate: Date | null = null;
    for (const p of inv.payments) {
      cum += Number(p.amount);
      if (cum >= amount - 0.01) { fullyPaidDate = p.date; break; }
    }
    if (!fullyPaidDate) continue;
    const d = daysBetween(inv.date, fullyPaidDate);
    if (d < 0 || d > 365) continue; // guard against bad data (prepaid/credits/refunds)

    const sid = Number(inv.serviceId);
    const isInsulation = INSULATION_IDS.has(sid);
    const isWildlife = WILDLIFE_IDS.has(sid) && !isInsulation;
    // Pest = neither wildlife nor insulation
    if (isInsulation) buckets.insulation.push(d);
    else if (isWildlife) buckets.wildlife.push(d);
    else buckets.pest.push(d);
  }

  const stats = (arr: number[]) => {
    if (!arr.length) return { n: 0, avg: null, median: null, min: null, max: null };
    const sorted = [...arr].sort((a, b) => a - b);
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return { n: arr.length, avg: Math.round(avg * 10) / 10, median, min: sorted[0], max: sorted[sorted.length - 1] };
  };

  return NextResponse.json({
    window: `trailing ${days} days (since ${since.toISOString().slice(0, 10)})`,
    office: office || 'All',
    invoicesConsidered: considered,
    fullyPaid: paidCount,
    note: 'Pest invoices are due the service day, so days-to-pay = invoice.date -> fully-paid date. Avg is what Chisam asked; median shown too (less skewed).',
    X_pestControl: stats(buckets.pest),
    Y_wildlife: stats(buckets.wildlife),
    Z_insulation: stats(buckets.insulation),
  });
}
