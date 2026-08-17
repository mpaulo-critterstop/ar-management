// Cancellations module data: churn report (counts/value by month, reason, office, service) + win-back list.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const office = sp.get('office');
  const where: any = {};
  if (office && office !== 'All') where.office = office;

  const rows = await prisma.pestCancellation.findMany({ where, orderBy: [{ dateCancelled: 'desc' }] });

  // ---- Churn report aggregations ----
  const byMonth = new Map<string, { month: string; count: number; lostCV: number; lostARV: number }>();
  const byReason = new Map<string, { reason: string; count: number; lostARV: number }>();
  const byService = new Map<string, { service: string; count: number; lostARV: number }>();
  let totalCount = 0, totalLostARV = 0, totalLostCV = 0, tenureSum = 0, tenureN = 0;

  for (const r of rows) {
    totalCount++; totalLostARV += r.annualRecurringValue || 0; totalLostCV += r.contractValue || 0;
    if (r.tenureDays != null) { tenureSum += r.tenureDays; tenureN++; }

    const mk = r.cancelMonth || 'unknown';
    const m = byMonth.get(mk) || { month: mk, count: 0, lostCV: 0, lostARV: 0 };
    m.count++; m.lostCV += r.contractValue || 0; m.lostARV += r.annualRecurringValue || 0;
    byMonth.set(mk, m);

    const rk = r.cancelReasonBucket || 'Other';
    const rr = byReason.get(rk) || { reason: rk, count: 0, lostARV: 0 };
    rr.count++; rr.lostARV += r.annualRecurringValue || 0;
    byReason.set(rk, rr);

    const sk = r.category || r.serviceType || 'Unknown';
    const ss = byService.get(sk) || { service: sk, count: 0, lostARV: 0 };
    ss.count++; ss.lostARV += r.annualRecurringValue || 0;
    byService.set(sk, ss);
  }

  const churn = {
    totals: { count: totalCount, lostARV: Math.round(totalLostARV), lostCV: Math.round(totalLostCV),
      avgTenureDays: tenureN ? Math.round(tenureSum / tenureN) : null },
    byMonth: [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)),
    byReason: [...byReason.values()].sort((a, b) => b.count - a.count),
    byService: [...byService.values()].sort((a, b) => b.count - a.count),
  };

  // ---- Win-back list ----
  // Actionable cancels: exclude clearly-unwinnable reasons (moved, deceased). Most recent first, with the
  // info the team needs to re-engage. Cap the payload; the UI paginates.
  const UNWINNABLE = new Set(['Moved / Relocated', 'Deceased / Health']);
  const winback = rows
    .filter(r => !UNWINNABLE.has(r.cancelReasonBucket || ''))
    .map(r => ({
      id: r.id, office: r.office, customerId: r.customerId, customerName: r.customerName,
      customerPhone: r.customerPhone, customerEmail: r.customerEmail,
      serviceType: r.serviceType, category: r.category,
      annualRecurringValue: r.annualRecurringValue, contractValue: r.contractValue,
      dateCancelled: r.dateCancelled, tenureDays: r.tenureDays,
      reasonBucket: r.cancelReasonBucket, reasonRaw: r.cancelReasonRaw,
    }));

  const offices = [...new Set(rows.map(r => r.office))].sort();
  return NextResponse.json({ churn, winback, cancellations: rows, offices, total: rows.length });
}
