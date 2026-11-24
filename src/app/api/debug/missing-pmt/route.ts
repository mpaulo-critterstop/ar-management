import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const txnId = req.nextUrl.searchParams.get('txn') || 'a123bc79-9651-48ee-bb33-abe1f4ed2e8f';
  const inv = req.nextUrl.searchParams.get('inv') || '284285';
  // 1) Hub ledger — any row for this txn or invoice?
  const byTxn = await prisma.staxPayment.findUnique({ where: { staxTransactionId: txnId } }).catch(() => null);
  const byInv = await prisma.staxPayment.findMany({ where: { frInvoiceNumber: inv } }).catch(() => []);
  // 2) the Stax transaction itself
  const headers = staxHeaders();
  const sg = await fetch(`${STAX_BASE}/transaction/${txnId}`, { headers }).then(r => r.json()).catch(() => null);
  const stax = sg?.id ? { id: sg.id, type: sg.type, method: sg.method, total: sg.total, success: sg.success, status: sg.status, created_at: sg.created_at, meta: sg.meta, invoice_id: sg.invoice_id, customer_id: sg.customer_id } : { error: 'not found', raw: sg };
  return NextResponse.json({
    txnId, inv,
    hubRowByTxn: byTxn ? { status: byTxn.status, frPaymentId: byTxn.frPaymentId, amount: byTxn.amount, failReason: byTxn.failReason } : null,
    hubRowsByInvoice: byInv.map((r:any)=>({ staxTransactionId:r.staxTransactionId, status:r.status, frPaymentId:r.frPaymentId })),
    staxTransaction: stax,
  });
}
