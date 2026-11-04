// Link an ONSITE payment (PM mobile reader, no invoice at capture) to an FR invoice. CSR provides the Stax
// transaction id + the FR invoice number (created after the sale). We fetch the txn from Stax, inject the
// invoice into its meta, and re-run the bridge — which applies it to FR and flips the row onsite -> written.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessModule } from '@/lib/access';
import { STAX_BASE, staxHeaders, processStaxTransaction } from '@/lib/staxBridge';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'helcim')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json().catch(() => null);
  const staxTransactionId = String(b?.staxTransactionId || '').trim();
  const invoiceNumber = String(b?.invoiceNumber || '').trim();
  if (!staxTransactionId || !invoiceNumber) return NextResponse.json({ error: 'staxTransactionId + invoiceNumber required' }, { status: 400 });

  // Must be an onsite row awaiting link.
  const row = await prisma.staxPayment.findUnique({ where: { staxTransactionId } });
  if (!row) return NextResponse.json({ error: 'payment not found' }, { status: 404 });
  if (row.status !== 'onsite') return NextResponse.json({ error: `payment is '${row.status}', not an unlinked onsite payment` }, { status: 409 });

  // Fetch the real txn from Stax, inject the FR invoice into meta, re-run the bridge.
  let txn: any = null;
  try {
    const r = await fetch(`${STAX_BASE}/transaction/${staxTransactionId}`, { headers: staxHeaders() });
    txn = await r.json();
  } catch (e) { return NextResponse.json({ error: 'could not fetch Stax transaction', detail: String(e) }, { status: 502 }); }
  if (!txn?.id) return NextResponse.json({ error: 'Stax transaction not found' }, { status: 404 });

  txn.meta = { ...(txn.meta || {}), fr_invoice: invoiceNumber };
  // Reset status so the bridge's claim can re-process it (onsite -> claimed -> written).
  await prisma.staxPayment.update({ where: { staxTransactionId }, data: { status: 'pending', frInvoiceNumber: invoiceNumber } });

  const result = await processStaxTransaction(txn, 'webhook');
  if (result.status === 'written' || result.status === 'already_written') {
    return NextResponse.json({ ok: true, linked: true, invoiceNumber, result });
  }
  // If it failed to match, revert to onsite so it's not lost.
  await prisma.staxPayment.update({ where: { staxTransactionId }, data: { status: 'onsite' } }).catch(() => {});
  return NextResponse.json({ ok: false, error: `Could not apply to invoice ${invoiceNumber}`, result }, { status: 422 });
}
