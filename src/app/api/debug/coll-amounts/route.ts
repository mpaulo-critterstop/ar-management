import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // sample SCC rows: compare tracker.amount vs invoice amount/paid/balance
  const rows = await prisma.collectionsTracker.findMany({ where: { track: 'SCC', stage: { notIn: ['PAID','REMOVED','BAD_DEBT_APPROVED'] } }, take: 12 });
  const out: any[] = [];
  for (const r of rows) {
    const inv = await prisma.invoice.findUnique({ where: { id: r.invoiceId }, select: { amount: true, paid: true } });
    const invAmt = inv ? Number(inv.amount) : null, paid = inv ? Number(inv.paid) : null;
    const bal = invAmt != null && paid != null ? Math.round((invAmt - paid) * 100) / 100 : null;
    out.push({ customer: r.customerName, trackerAmount: Number(r.amount), invoiceTotal: invAmt, paid, balance: bal, matchesBalance: bal != null && Math.abs(Number(r.amount) - bal) < 0.01 });
  }
  return NextResponse.json({ sccRows: out });
}
