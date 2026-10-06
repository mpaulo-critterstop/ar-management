// Diagnostic: find where the Actual AR jump comes from. Compares:
//  A) stored-paid method: sum(amount - paid)
//  B) summed-payments method: sum(amount - sum(payments))  [what the benchmark now uses]
// and breaks the outstanding balance down by invoice age + flags where paid-field != summed-payments.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = Date.now();

  const inv = await prisma.invoice.findMany({
    select: { amount: true, paid: true, date: true, status: true, payments: { select: { amount: true } } },
  });

  let arStoredPaid = 0;      // method A: amount - paid
  let arSummedPayments = 0;  // method B: amount - sum(payments)
  const ageBuckets: Record<string, number> = { '0-90d': 0, '90-180d': 0, '180-365d': 0, 'over 1yr': 0 };
  let mismatchCount = 0, mismatchTotal = 0;
  const byStatus: Record<string, number> = {};

  for (const i of inv) {
    const amount = Number(i.amount);
    if (amount <= 0) continue;
    const storedPaid = Number(i.paid);
    const summedPaid = i.payments.reduce((s, p) => s + Number(p.amount), 0);

    const balA = amount - storedPaid;
    const balB = amount - summedPaid;
    if (balA > 0.01) arStoredPaid += balA;
    if (balB > 0.01) {
      arSummedPayments += balB;
      const ageDays = (now - i.date.getTime()) / 86400000;
      const bkt = ageDays <= 90 ? '0-90d' : ageDays <= 180 ? '90-180d' : ageDays <= 365 ? '180-365d' : 'over 1yr';
      ageBuckets[bkt] += balB;
      byStatus[i.status] = (byStatus[i.status] || 0) + balB;
    }
    // where do stored-paid and summed-payments disagree?
    if (Math.abs(storedPaid - summedPaid) > 0.01) { mismatchCount++; mismatchTotal += (storedPaid - summedPaid); }
  }

  const r = (n: number) => Math.round(n * 100) / 100;
  return NextResponse.json({
    method_A_storedPaid: r(arStoredPaid),
    method_B_summedPayments: r(arSummedPayments),
    difference_B_minus_A: r(arSummedPayments - arStoredPaid),
    summedPayments_AR_byAge: Object.fromEntries(Object.entries(ageBuckets).map(([k, v]) => [k, r(v)])),
    summedPayments_AR_byStatus: Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, r(v)])),
    paidField_vs_payments_mismatch: { invoices: mismatchCount, netStoredMinusSummed: r(mismatchTotal) },
    note: 'If difference is large, the summed-payments method (B) is overstating AR — likely because paid-field includes credits/adjustments not in Payment rows, or payments not fully synced. byAge shows if old dead AR is inflating it.',
  });
}
