import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processStaxTransaction, staxHeaders } from '@/lib/staxBridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STAX_BASE = 'https://apiprod.fattlabs.com';

// Retry a flagged/failed Stax payment: re-fetch the live transaction and re-run the bridge.
// Useful when the invoice didn't exist in FR at payment time but does now (the common flagged case).
// Optional invoiceOverride stamps an invoice number onto the txn before reprocessing (when the CSR knows it
// but auto-detect can't find it).
// POST { staxTransactionId, invoiceOverride? }
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const staxTransactionId = String(b.staxTransactionId || '');
  const invoiceOverride = b.invoiceOverride ? String(b.invoiceOverride).trim() : null;
  if (!staxTransactionId) return NextResponse.json({ error: 'staxTransactionId required' }, { status: 400 });

  const row = await prisma.staxPayment.findUnique({ where: { staxTransactionId } });
  if (!row) return NextResponse.json({ error: 'payment not found' }, { status: 404 });
  if (row.status === 'written') return NextResponse.json({ ok: true, status: 'already_written', note: 'This payment is already recorded in FR.' });

  // 1) Re-fetch the live transaction from Stax
  let txn: any = null;
  try {
    const res = await fetch(`${STAX_BASE}/transaction/${staxTransactionId}`, { headers: staxHeaders() });
    txn = await res.json().catch(() => null);
    if (!res.ok || !txn?.id) return NextResponse.json({ error: 'could not fetch transaction from Stax', detail: txn }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: 'Stax fetch failed: ' + String(e) }, { status: 502 });
  }

  // 2) If an invoice override was given, stamp it where the bridge looks for it.
  if (invoiceOverride) {
    txn.meta = { ...(txn.meta || {}), fr_invoice: invoiceOverride };
  }

  // 3) Reset the row to pending so the bridge's claim logic can re-process it (it won't touch written/claimed).
  await prisma.staxPayment.update({ where: { staxTransactionId }, data: { status: 'pending', failReason: null } });

  // 4) Re-run the bridge
  const result = await processStaxTransaction(txn, 'poll');

  // 5) Read back the final state
  const after = await prisma.staxPayment.findUnique({ where: { staxTransactionId }, select: { status: true, failReason: true, office: true, frPaymentId: true } });
  return NextResponse.json({ ok: result.status === 'written' || result.status === 'already_written', result, row: after });
}
