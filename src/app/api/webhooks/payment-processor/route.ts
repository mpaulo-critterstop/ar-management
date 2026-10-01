// Helcim webhook receiver. Helcim POSTs here when a transaction occurs (near-real-time). The webhook payload
// is minimal (typically a transaction id + type), so we fetch the full transaction from Helcim, then process it
// via the shared bridge logic. Polling is the safety net that catches anything this misses.
import { NextRequest, NextResponse } from 'next/server';
import { processHelcimTransaction } from '@/lib/helcimBridge';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const HELCIM_BASE = 'https://api.helcim.com/v2';

// Verify a Helcim webhook (Standard Webhooks scheme): signedContent = `${id}.${timestamp}.${body}`,
// HMAC-SHA256 keyed by the BASE64-DECODED verifier token, base64-encoded, compared to the v1 entry in the
// webhook-signature header. Returns true if valid OR if no verifier token is configured (so it still works
// before the token is set — but set HELCIM_WEBHOOK_VERIFIER in Vercel for real security).
function verifyHelcimSignature(id: string, timestamp: string, sigHeader: string, body: string): { ok: boolean; reason?: string } {
  const verifier = process.env.HELCIM_WEBHOOK_VERIFIER;
  if (!verifier) return { ok: true, reason: 'no verifier configured (set HELCIM_WEBHOOK_VERIFIER)' };
  if (!id || !timestamp || !sigHeader) return { ok: false, reason: 'missing signature headers' };
  try {
    const signedContent = `${id}.${timestamp}.${body}`;
    const key = Buffer.from(verifier, 'base64');
    const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');
    // header may contain space-delimited "v1,sig v1,sig2"; match any v1 entry, constant-time
    const candidates = sigHeader.split(' ').map(s => s.startsWith('v1,') ? s.slice(3) : s);
    for (const c of candidates) {
      try { if (c.length === expected.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(expected))) return { ok: true }; } catch { /* length mismatch */ }
    }
    return { ok: false, reason: 'signature mismatch' };
  } catch (e: any) { return { ok: false, reason: `verify error: ${String(e).slice(0, 80)}` }; }
}

export async function POST(req: NextRequest) {
  // Record that a webhook fired (heartbeat), even before processing.
  const raw = await req.text();

  // Verify the signature (confirms the POST is really from Helcim, not spoofed).
  const vr = verifyHelcimSignature(
    req.headers.get('webhook-id') || '', req.headers.get('webhook-timestamp') || '',
    req.headers.get('webhook-signature') || '', raw,
  );
  await prisma.appSetting.upsert({
    where: { key: 'helcim_webhook_last' },
    create: { key: 'helcim_webhook_last', value: `${new Date().toISOString()} verified=${vr.ok}${vr.reason ? ' (' + vr.reason + ')' : ''} :: ${raw.slice(0, 160)}` },
    update: { value: `${new Date().toISOString()} verified=${vr.ok}${vr.reason ? ' (' + vr.reason + ')' : ''} :: ${raw.slice(0, 160)}` },
  }).catch(() => {});
  if (!vr.ok) return NextResponse.json({ error: 'invalid signature', reason: vr.reason }, { status: 401 });

  let body: any; try { body = JSON.parse(raw); } catch { body = null; }

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
