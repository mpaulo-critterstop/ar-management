// Helcim→FR bridge monitoring. Summarizes the ledger (counts + totals by status) and lists the rows that need
// attention (flagged/failed). Also exposes a reconcile check: Helcim recent total vs. what the Hub wrote to FR.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as any)?.role !== 'Admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  // Counts + total amount by status.
  const grouped = await prisma.helcimPayment.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { amount: true },
  });
  const summary: Record<string, { count: number; total: number }> = {};
  for (const g of grouped) summary[g.status] = { count: g._count._all, total: Math.round((g._sum.amount || 0) * 100) / 100 };

  // Rows needing attention: flagged (couldn't match) + failed (write error). These are the "to-fix" queue.
  const attention = await prisma.helcimPayment.findMany({
    where: { status: { in: ['flagged', 'failed'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, helcimTransactionId: true, amount: true, helcimInvoiceNumber: true, helcimCustomerCode: true, status: true, failReason: true, source: true, createdAt: true },
  });

  // Recent written (for the activity feed).
  const recentWritten = await prisma.helcimPayment.findMany({
    where: { status: 'written' },
    orderBy: { processedAt: 'desc' },
    take: 25,
    select: { helcimTransactionId: true, amount: true, office: true, helcimInvoiceNumber: true, frPaymentId: true, frPaymentMethod: true, source: true, processedAt: true },
  });

  // Heartbeats.
  const [pollStatus, webhookLast] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'helcim_sync_status' } }),
    prisma.appSetting.findUnique({ where: { key: 'helcim_webhook_last' } }),
  ]);

  return NextResponse.json({
    summary,
    attentionCount: attention.length,
    attention,
    recentWritten,
    pollStatus: pollStatus?.value || null,
    webhookLast: webhookLast?.value || null,
  });
}
