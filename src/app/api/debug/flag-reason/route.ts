import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const inv = req.nextUrl.searchParams.get('inv') || '286326';
  // Hub ledger rows for this invoice
  const rows = await prisma.staxPayment.findMany({ where: { frInvoiceNumber: inv } });
  // Also check recently-flagged rows to see the pattern of "invoice cannot be found"
  const flagged = await prisma.staxPayment.findMany({
    where: { status: 'flagged' },
    orderBy: { createdAt: 'desc' }, take: 20,
    select: { staxTransactionId: true, frInvoiceNumber: true, amount: true, cardHolderName: true, failReason: true, createdAt: true },
  });
  // Pull David's stax txn to see where fr_invoice lives in the payload
  let staxTxn: any = null;
  if (rows[0]?.staxTransactionId) {
    const headers = staxHeaders();
    const r = await fetch(`${STAX_BASE}/transaction/${rows[0].staxTransactionId}`, { headers }).then(r => r.json()).catch(() => null);
    if (r?.id) staxTxn = { id: r.id, type: r.type, total: r.total, created_at: r.created_at, meta: r.meta, invoice_id: r.invoice_id, payment_method_meta: r.payment_method?.meta, hasInvoiceObj: !!r.invoice };
  }
  return NextResponse.json({
    invoice: inv,
    hubRows: rows.map(r => ({ txn: r.staxTransactionId, status: r.status, frInvoiceNumber: r.frInvoiceNumber, frPaymentId: r.frPaymentId, failReason: r.failReason })),
    davidStaxTxn: staxTxn,
    recentFlagged: flagged,
  });
}
