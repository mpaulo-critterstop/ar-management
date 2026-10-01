// Helcim polling cron — the safety net behind the webhook. Fetches recent Helcim transactions and runs each
// through the shared bridge logic. Because processing is idempotent (dedup via the ledger), re-processing
// already-written transactions is a no-op — so this reliably catches anything the webhook missed.
//   /api/cron/helcim-sync?token=critterstop2026            (process recent)
//   /api/cron/helcim-sync?token=critterstop2026&limit=100&dry=1   (preview without writing)
import { NextRequest, NextResponse } from 'next/server';
import { processHelcimTransaction } from '@/lib/helcimBridge';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HELCIM_BASE = 'https://api.helcim.com/v2';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== process.env.CRON_SECRET && sp.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apiToken = process.env.HELCIM_API_TOKEN;
  if (!apiToken) return NextResponse.json({ error: 'HELCIM_API_TOKEN not set' }, { status: 400 });
  const limit = parseInt(sp.get('limit') || '50');
  const dry = sp.get('dry') === '1';

  const setStatus = (m: string) => prisma.appSetting.upsert({ where: { key: 'helcim_sync_status' }, create: { key: 'helcim_sync_status', value: m }, update: { value: m } }).catch(() => {});

  // Fetch recent transactions from Helcim.
  let txns: any[] = [];
  try {
    const r = await fetch(`${HELCIM_BASE}/card-transactions?limit=${limit}`, { headers: { accept: 'application/json', 'api-token': apiToken } });
    const j = await r.json();
    txns = Array.isArray(j) ? j : (j?.transactions || j?.data || []);
  } catch (e: any) {
    await setStatus(`ERROR fetch: ${String(e).slice(0, 150)} @ ${new Date().toISOString()}`);
    return NextResponse.json({ error: 'helcim fetch failed', detail: String(e).slice(0, 150) }, { status: 502 });
  }

  const results = { seen: txns.length, written: 0, already: 0, skipped: 0, flagged: 0, failed: 0 } as any;
  const details: any[] = [];

  for (const t of txns) {
    const norm = { ...t, transactionId: t.transactionId || t.id };
    if (dry) {
      details.push({ transactionId: norm.transactionId, amount: t.amount, status: t.status, invoiceNumber: t.invoiceNumber, wouldProcess: String(t.status).toUpperCase() === 'APPROVED' && !!t.invoiceNumber });
      continue;
    }
    const res = await processHelcimTransaction(norm, 'poll');
    if (res.status === 'written') results.written++;
    else if (res.status === 'already_written') results.already++;
    else if (res.status === 'skipped') results.skipped++;
    else if (res.status === 'flagged') results.flagged++;
    else results.failed++;
    if (res.status !== 'already_written') details.push({ transactionId: norm.transactionId, result: res.status, reason: res.reason });
  }

  if (!dry) await setStatus(`done: seen ${results.seen}, wrote ${results.written}, already ${results.already}, flagged ${results.flagged}, failed ${results.failed} @ ${new Date().toISOString()}`);
  return NextResponse.json({ dry, ...results, details });
}
