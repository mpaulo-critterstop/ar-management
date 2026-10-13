// Stax sandbox probe — verify API access + the full flow before going live. Admin/token gated.
//   /api/debug/stax-probe?token=critterstop2026&action=ping
//   &action=self                      → GET /self (confirms key works + shows merchant)
//   &action=charge&invoice=<FRinv>&amount=1.00   → create customer + test-card payment-method + charge, tagged with FR invoice (meta.fr_invoice); the create_transaction webhook (or the poll) then records it to FR
//   &action=paymentlink&invoice=<FRinv>&amount=1.00  → create a payment link tagged with the FR invoice
//   &action=process&txn=<staxTxnId>   → manually run a known Stax txn through the FR bridge
import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders, processStaxTransaction } from '@/lib/staxBridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function sx(path: string, method = 'GET', body?: any) {
  const r = await fetch(`${STAX_BASE}${path}`, { method, headers: staxHeaders(), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { ok: r.ok, status: r.status, json };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026' && sp.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.STAX_API_KEY) return NextResponse.json({ error: 'STAX_API_KEY env var not set' }, { status: 500 });
  const action = sp.get('action') || 'ping';

  try {
    if (action === 'ping' || action === 'self') {
      // /self returns the authenticated user + merchant — the cleanest "is my key working" check.
      const self = await sx('/self');
      return NextResponse.json({ action: 'self', ...self });
    }

    if (action === 'charge') {
      const frInvoice = sp.get('invoice');
      const amount = parseFloat(sp.get('amount') || '1.00');
      if (!frInvoice) return NextResponse.json({ error: 'invoice (FR invoice #) required' }, { status: 400 });

      // 1) customer
      const cust = await sx('/customer', 'POST', { firstname: 'Sandbox', lastname: 'Test', email: 'sandbox@critterstop.com' });
      if (!cust.ok) return NextResponse.json({ step: 'create customer failed', ...cust });
      const customerId = cust.json?.id;

      // 2) payment method (Visa success test card)
      const pm = await sx('/payment-method', 'POST', {
        customer_id: customerId, method: 'card', person_name: 'Sandbox Test',
        card_number: '4111111111111111', card_cvv: '123', card_exp: '0427', card_type: 'visa',
      });
      if (!pm.ok) return NextResponse.json({ step: 'create payment-method failed', ...pm });
      const paymentMethodId = pm.json?.id;

      // 3) charge — tagged with the FR invoice in meta so the webhook/bridge can match it
      const charge = await sx('/charge', 'POST', {
        payment_method_id: paymentMethodId, total: amount, pre_auth: false,
        meta: { fr_invoice: frInvoice, memo: 'Hub sandbox test' },
        idempotency_id: `sandbox-${frInvoice}-${Date.now()}`,
      });
      return NextResponse.json({
        action: 'charge', customerId, paymentMethodId,
        chargeStatus: charge.status, charge: charge.json,
        note: 'If successful, the create_transaction webhook should record this to FR. Or call &action=process&txn=<id> to run the bridge manually.',
      });
    }

    if (action === 'paymentlink') {
      const frInvoice = sp.get('invoice');
      const amount = parseFloat(sp.get('amount') || '1.00');
      if (!frInvoice) return NextResponse.json({ error: 'invoice required' }, { status: 400 });
      // Stax payment-link: requires url + common_name; amount optional (fixed vs variable). We tag FR invoice in link_meta.
      const link = await sx('/query/payment-links', 'POST', {
        common_name: `FR Invoice ${frInvoice}`,
        url: `invoice-${frInvoice}-${Date.now()}`,
        amount, active: 1,
        link_meta: { fr_invoice: frInvoice },
      });
      return NextResponse.json({ action: 'paymentlink', status: link.status, link: link.json });
    }

    if (action === 'process') {
      const txnId = sp.get('txn');
      if (!txnId) return NextResponse.json({ error: 'txn (stax transaction id) required' }, { status: 400 });
      const t = await sx(`/transaction/${txnId}`);
      if (!t.ok) return NextResponse.json({ step: 'get transaction failed', ...t });
      const result = await processStaxTransaction(t.json, 'poll');
      return NextResponse.json({ action: 'process', bridgeResult: result, txn: t.json });
    }

    return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}
