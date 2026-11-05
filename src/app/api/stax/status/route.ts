// Stax->FR bridge monitoring. Separate lists per status: recorded (written, NOT refunded), refunded, flagged,
// failed, pending. Refund-marker rows are used to detect which originals were refunded, then excluded from lists.
// 'skipped' is excluded entirely.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessModule } from '@/lib/access';

export const dynamic = 'force-dynamic';

const SELECT = { id: true, staxTransactionId: true, amount: true, office: true, frInvoiceNumber: true, frPaymentId: true, frPaymentMethod: true, cardLast4: true, staxCustomerId: true, frCustomerId: true, cardHolderName: true, status: true, staxType: true, failReason: true, source: true, processedAt: true, createdAt: true } as const;
// A row is a refund-dedup MARKER only if its id is prefixed 'refund:'. A real charge/payment row (even one
// whose staxType got mislabeled) has a real Stax transaction id (no prefix) and typically an frPaymentId.
const isRefundMarker = (r: any) => String(r.staxTransactionId || '').startsWith('refund:');

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Anyone with Stax Payments module access can view the Payment Report (Admin + Manager auto; others if granted).
  if (!canAccessModule(session.user as any, 'helcim')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const ONSITE_SELECT = { ...SELECT, frCustomerId: true, cardHolderName: true } as const;
  const DECLINED_SELECT = { ...SELECT, cardHolderName: true, failReason: true } as const;
  const [writtenRaw, flaggedRaw, failedRaw, pendingRaw, onsiteRaw, declinedRaw] = await Promise.all([
    prisma.staxPayment.findMany({ where: { status: 'written' }, orderBy: { processedAt: 'desc' }, take: 1000, select: SELECT }).catch(() => [] as any[]),
    prisma.staxPayment.findMany({ where: { status: 'flagged' }, orderBy: { createdAt: 'desc' }, take: 200, select: SELECT }).catch(() => [] as any[]),
    prisma.staxPayment.findMany({ where: { status: 'failed' }, orderBy: { createdAt: 'desc' }, take: 200, select: SELECT }).catch(() => [] as any[]),
    prisma.staxPayment.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 200, select: SELECT }).catch(() => [] as any[]),
    prisma.staxPayment.findMany({ where: { status: 'onsite' }, orderBy: { createdAt: 'desc' }, take: 500, select: ONSITE_SELECT }).catch(() => [] as any[]),
    prisma.staxPayment.findMany({ where: { status: 'declined' }, orderBy: { createdAt: 'desc' }, take: 500, select: DECLINED_SELECT }).catch(() => [] as any[]),
  ]);
  // Resolve FR customer names for ALL groups (from our DB, by externalId = FR customer id). Falls back to the
  // card-holder name on the Stax txn when we have no FR customer id (e.g. some flagged/declined rows).
  const allRows = [...writtenRaw, ...flaggedRaw, ...failedRaw, ...pendingRaw, ...onsiteRaw, ...declinedRaw];
  const allCustIds = [...new Set(allRows.map((r: any) => r.frCustomerId).filter(Boolean))] as string[];
  const custNameById = new Map<string, string>();
  if (allCustIds.length) {
    const cs = await prisma.customer.findMany({ where: { externalId: { in: allCustIds } }, select: { externalId: true, name: true } }).catch(() => [] as any[]);
    for (const c of cs) if (c.externalId) custNameById.set(c.externalId, c.name);
  }
  const withName = (r: any) => ({ ...r, customerName: (r.frCustomerId && custNameById.get(r.frCustomerId)) || r.cardHolderName || null });
  const onsite = onsiteRaw.map((r: any) => ({ ...withName(r), frCustomerName: r.frCustomerId ? (custNameById.get(r.frCustomerId) || null) : null }));

  // Which original txns were refunded (a refund:<origId> marker exists)?
  const refundedOrigIds = new Set<string>();
  for (const m of writtenRaw.filter(isRefundMarker)) {
    const id = String(m.staxTransactionId || '');
    if (id.startsWith('refund:')) refundedOrigIds.add(id.slice('refund:'.length));
  }

  const realWritten = writtenRaw.filter((r: any) => !isRefundMarker(r));
  // Recorded = written real payments that are NOT refunded. Refunded = written real payments that ARE refunded.
  const recorded = realWritten.filter((r: any) => !refundedOrigIds.has(String(r.staxTransactionId))).map(withName);
  const refunded = realWritten.filter((r: any) => refundedOrigIds.has(String(r.staxTransactionId))).map(withName);
  const clean = (arr: any[]) => arr.filter((r: any) => !isRefundMarker(r)).map(withName);
  const flagged = clean(flaggedRaw), failed = clean(failedRaw), pending = clean(pendingRaw);
  const declined = declinedRaw.map(withName);
  const sum = (arr: any[]) => Math.round(arr.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;

  return NextResponse.json({
    summary: {
      recorded: { count: recorded.length, total: sum(recorded) },
      refunded: { count: refunded.length, total: sum(refunded) },
      flagged: { count: flagged.length, total: sum(flagged) },
      failed: { count: failed.length, total: sum(failed) },
      pending: { count: pending.length, total: sum(pending) },
      onsite: { count: onsite.length, total: sum(onsite) },
      declined: { count: declined.length, total: sum(declined) },
    },
    recorded, refunded, flagged, failed, pending, onsite, declined,
  });
}
