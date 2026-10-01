// Helcim webhook receiver. Helcim POSTs here when a transaction occurs (near-real-time). The webhook payload
// is minimal (typically a transaction id + type), so we fetch the full transaction from Helcim, then process it
// via the shared bridge logic. Polling is the safety net that catches anything this misses.
import { NextRequest, NextResponse } from 'next/server';
import { processHelcimTransaction } from '@/lib/helcimBridge';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const HELCIM_BASE = 'https://api.helcim.com/v2';

export async function POST(req: NextRequest) {
  // Record that a webhook fired (heartbeat), even before processing.
  const raw = await req.text();
  let body: any; try { body = JSON.parse(raw); } catch { body = null; }
  await prisma.appSetting.upsert({
    where: { key: 'helcim_webhook_last' },
    create: { key: 'helcim_webhook_last', value: `${new Date().toISOString()} :: ${raw.slice(0, 200)}` },
    update: { value: `${new Date().toISOString()} :: ${raw.slice(0, 200)}` },
  }).catch(() => {});

  // Helcim webhook typically delivers an id + type. Pull the transaction id.
  const txnId = body?.id || body?.transactionId || body?.data?.id;
  if (!txnId) return NextResponse.json({ ok: true, note: 'no transaction id in webhook payload' });

  const apiToken = process.env.HELCIM_API_TOKEN;
  if (!apiToken) return NextResponse.json({ ok: true, note: 'HELCIM_API_TOKEN not set' });

  try {
    // Fetch the full transaction from Helcim (webhook payload is minimal).
    const r = await fetch(`${HELCIM_BASE}/card-transactions/${txnId}`, { headers: { accept: 'application/json', 'api-token': apiToken } });
    const txn = await r.json();
    if (!txn || (!txn.transactionId && !txn.id)) return NextResponse.json({ ok: true, note: 'could not fetch transaction', txnId });
    const norm = { ...txn, transactionId: txn.transactionId || txn.id };
    const result = await processHelcimTransaction(norm, 'webhook');
    return NextResponse.json({ ok: true, txnId, result });
  } catch (e: any) {
    return NextResponse.json({ ok: true, note: 'processing error (poll will retry)', error: String(e).slice(0, 150) });
  }
}

// Helcim may send a GET to verify the endpoint.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'payment-processor-webhook' });
}
