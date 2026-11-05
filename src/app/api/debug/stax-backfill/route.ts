// One-time backfill: pull recent Stax transactions and re-run each through the bridge, so historical DECLINED
// charges populate the Declined tile and any previously-failed charges (e.g. parent/child billTo) get re-tried
// with the current logic. Idempotent — already-written rows are skipped by the bridge's claim.
//   GET ?token=critterstop2026[&pages=5][&dry=1][&txn=<id>]
//   &txn=<id> re-processes a single transaction (e.g. the one stuck 'failed').
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { STAX_BASE, staxHeaders, processStaxTransaction } from '@/lib/staxBridge';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const headers = staxHeaders();
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const singleTxn = req.nextUrl.searchParams.get('txn');

  // Retry all ledger rows stuck in 'failed' (e.g. the parent/child billTo error) through the current bridge.
  if (req.nextUrl.searchParams.get('retryFailed') === '1') {
    const failedRows = await prisma.staxPayment.findMany({ where: { status: 'failed' }, select: { staxTransactionId: true, failReason: true, frInvoiceNumber: true } });
    if (dry) return NextResponse.json({ dry: true, failedCount: failedRows.length, rows: failedRows });
    const out: any[] = [];
    for (const row of failedRows) {
      const r = await fetch(`${STAX_BASE}/transaction/${row.staxTransactionId}`, { headers });
      const txn = await r.json().catch(() => null);
      if (!txn?.id) { out.push({ txn: row.staxTransactionId, result: 'txn-not-found' }); continue; }
      // reset so the claim can re-process
      await prisma.staxPayment.update({ where: { staxTransactionId: row.staxTransactionId }, data: { status: 'pending' } }).catch(() => {});
      const result = await processStaxTransaction(txn, 'poll').catch((e) => ({ status: 'error', reason: String(e) } as any));
      out.push({ txn: row.staxTransactionId, invoice: row.frInvoiceNumber, result });
    }
    return NextResponse.json({ ok: true, retried: out.length, results: out });
  }

  // Single-transaction mode (re-process the one stuck failed payment).
  if (singleTxn) {
    const r = await fetch(`${STAX_BASE}/transaction/${singleTxn}`, { headers });
    const txn = await r.json().catch(() => null);
    if (!txn?.id) return NextResponse.json({ error: 'txn not found' }, { status: 404 });
    if (dry) return NextResponse.json({ dry: true, txn: { id: txn.id, type: txn.type, success: txn.success, total: txn.total, meta: txn.meta } });
    const result = await processStaxTransaction(txn, 'poll');
    return NextResponse.json({ ok: true, txn: singleTxn, result });
  }

  const pages = Math.min(parseInt(req.nextUrl.searchParams.get('pages') || '5'), 20);
  const summary = { processed: 0, written: 0, declined: 0, onsite: 0, flagged: 0, failed: 0, skipped: 0, other: 0 };
  const declinedFound: any[] = [];

  for (let page = 1; page <= pages; page++) {
    // Stax paginated transaction list, newest first.
    const r = await fetch(`${STAX_BASE}/transaction?page=${page}&per_page=50`, { headers });
    const j = await r.json().catch(() => null);
    const data = j?.data || [];
    if (!Array.isArray(data) || !data.length) break;
    for (const txn of data) {
      const type = String(txn?.type || '').toLowerCase();
      if (type !== 'charge' && type !== 'capture') continue; // only charges matter here
      summary.processed++;
      const isDeclined = txn?.success === false;
      if (isDeclined) declinedFound.push({ id: txn.id, total: txn.total, last4: txn?.payment_method?.card_last_four, name: txn?.payment_method?.person_name, msg: txn?.message });
      if (dry) continue;
      const result = await processStaxTransaction(txn, 'poll').catch(() => ({ status: 'error' } as any));
      const st = result?.status || 'other';
      if (st in summary) (summary as any)[st]++; else summary.other++;
    }
  }

  return NextResponse.json({ ok: true, dry, pagesScanned: pages, summary, declinedSample: declinedFound.slice(0, 20) });
}
