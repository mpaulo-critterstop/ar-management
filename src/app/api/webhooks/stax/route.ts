// Stax webhook receiver. Stax fires `create_transaction` (and others) with the transaction object as payload.
// We process charges through the bridge to auto-record them on the matching FR invoice — same pattern as the
// Helcim webhook. Configure this URL in Stax (Merchant Webhooks API) to point here.
//   POST /api/webhooks/stax
import { NextRequest, NextResponse } from 'next/server';
import { processStaxTransaction } from '@/lib/staxBridge';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  // Stax webhook payloads mirror the GET resource. A transaction event has the transaction object (with id,
  // type, total, success/status, payment_method, customer_id, meta). Some webhook shapes wrap it; handle both.
  const txn = body?.transaction || body?.data || body;
  const eventType = body?.type || body?.event || 'create_transaction';

  // Only transaction events are relevant to the FR bridge.
  if (!txn?.id && !txn?.transaction_id) {
    return NextResponse.json({ ok: true, ignored: `no transaction in payload (event=${eventType})` });
  }

  try {
    const result = await processStaxTransaction(txn, 'webhook');
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    // Return 200 so Stax doesn't hammer retries on a transient error; we log + the poll safety-net catches it.
    console.error('[stax webhook] error:', e);
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) });
  }
}

// Stax may send a GET to verify the endpoint — respond OK.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'stax-webhook' });
}
