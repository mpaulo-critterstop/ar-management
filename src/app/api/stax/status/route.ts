// Stax→FR bridge monitoring. Summarizes the stax_payments ledger (counts + totals by status) + the
// attention queue (flagged/failed) + recent written. Mirrors /api/helcim/status.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as any)?.role !== 'Admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  const grouped = await prisma.staxPayment.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }).catch(() => [] as any[]);
  const summary: Record<string, { count: number; total: number }> = {};
  for (const g of grouped) summary[g.status] = { count: g._count._all, total: Math.round((g._sum.amount || 0) * 100) / 100 };

  const attention = await prisma.staxPayment.findMany({
    where: { status: { in: ['flagged', 'failed'] } },
    orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, staxTransactionId: true, amount: true, frInvoiceNumber: true, staxCustomerId: true, status: true, failReason: true, source: true, createdAt: true },
  }).catch(() => [] as any[]);

  const recentWritten = await prisma.staxPayment.findMany({
    where: { status: 'written' },
    orderBy: { processedAt: 'desc' }, take: 25,
    select: { staxTransactionId: true, amount: true, office: true, frInvoiceNumber: true, frPaymentId: true, frPaymentMethod: true, source: true, processedAt: true },
  }).catch(() => [] as any[]);

  return NextResponse.json({ summary, attention, recentWritten });
}
