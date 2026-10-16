// Stax->FR bridge monitoring. Separate lists per status: recorded (written, NOT refunded), refunded, flagged,
// failed, pending. Refund-marker rows are used to detect which originals were refunded, then excluded from lists.
// 'skipped' is excluded entirely.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const SELECT = { id: true, staxTransactionId: true, amount: true, office: true, frInvoiceNumber: true, frPaymentId: true, frPaymentMethod: true, staxCustomerId: true, status: true, staxType: true, failReason: true, source: true, processedAt: true, createdAt: true } as const;
const isRefundMarker = (r: any) => String(r.staxTransactionId || '').startsWith('refund:') || r.staxType === 'refund';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as any)?.role !== 'Admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  const [writtenRaw, flaggedRaw, failedRaw, pendingRaw] = await Promise.all([
    prisma.staxPayment.findMany({ where: { status: 'written' }, orderBy: { processedAt: 'desc' }, take: 1000, select: SELECT }).catch(() => [] as any[]),
    prisma.staxPayment.findMany({ where: { status: 'flagged' }, orderBy: { createdAt: 'desc' }, take: 200, select: SELECT }).catch(() => [] as any[]),
    prisma.staxPayment.findMany({ where: { status: 'failed' }, orderBy: { createdAt: 'desc' }, take: 200, select: SELECT }).catch(() => [] as any[]),
    prisma.staxPayment.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 200, select: SELECT }).catch(() => [] as any[]),
  ]);

  // Which original txns were refunded (a refund:<origId> marker exists)?
  const refundedOrigIds = new Set<string>();
  for (const m of writtenRaw.filter(isRefundMarker)) {
    const id = String(m.staxTransactionId || '');
    if (id.startsWith('refund:')) refundedOrigIds.add(id.slice('refund:'.length));
  }

  const realWritten = writtenRaw.filter((r: any) => !isRefundMarker(r));
  // Recorded = written real payments that are NOT refunded. Refunded = written real payments that ARE refunded.
  const recorded = realWritten.filter((r: any) => !refundedOrigIds.has(String(r.staxTransactionId)));
  const refunded = realWritten.filter((r: any) => refundedOrigIds.has(String(r.staxTransactionId)));
  const clean = (arr: any[]) => arr.filter((r: any) => !isRefundMarker(r));
  const flagged = clean(flaggedRaw), failed = clean(failedRaw), pending = clean(pendingRaw);
  const sum = (arr: any[]) => Math.round(arr.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;

  return NextResponse.json({
    summary: {
      recorded: { count: recorded.length, total: sum(recorded) },
      refunded: { count: refunded.length, total: sum(refunded) },
      flagged: { count: flagged.length, total: sum(flagged) },
      failed: { count: failed.length, total: sum(failed) },
      pending: { count: pending.length, total: sum(pending) },
    },
    recorded, refunded, flagged, failed, pending,
  });
}
