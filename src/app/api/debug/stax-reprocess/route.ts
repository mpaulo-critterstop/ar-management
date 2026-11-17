import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { STAX_BASE, staxHeaders, processStaxTransaction } from '@/lib/staxBridge';
export const dynamic = 'force-dynamic';
// One-off: reprocess a flagged Stax txn now that its FR invoice exists. ?token=&txn=&inv=
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const staxTransactionId = String(sp.get('txn') || '').trim();
  const invoiceNumber = String(sp.get('inv') || '').trim();
  if (!staxTransactionId || !invoiceNumber) return NextResponse.json({ error: 'txn + inv required' }, { status: 400 });
  let txn: any;
  try {
    const r = await fetch(`${STAX_BASE}/transaction/${staxTransactionId}`, { headers: staxHeaders() });
    txn = await r.json();
  } catch (e) { return NextResponse.json({ error: 'could not fetch Stax txn', detail: String(e) }, { status: 502 }); }
  if (!txn?.id) return NextResponse.json({ error: 'Stax txn not found' }, { status: 404 });
  txn.meta = { ...(txn.meta || {}), fr_invoice: invoiceNumber };
  txn.invoiceNumber = invoiceNumber;
  const result = await processStaxTransaction(txn, 'poll');
  return NextResponse.json({ ok: true, result });
}
