// Stax → FieldRoutes bridge. Mirrors the proven Helcim bridge: when a Stax transaction is created, record it
// on the correct FR invoice (record-only, doCharge=0), with dedup via a ledger, validation, and the same
// FR-payment-id fallback lookup. FR only ever talks to the Hub; the Hub talks to Stax.
//
// Stax specifics:
//  - API base https://apiprod.fattlabs.com/ (same for sandbox + live), auth: Authorization: Bearer <STAX_API_KEY>
//  - A charge/payment-link payment fires the `create_transaction` webhook with the transaction object.
//  - We tag each Stax charge/invoice with the FR invoice number (in meta) so the webhook can match it to FR.
import { prisma } from '@/lib/prisma';
import { FR_OFFICES, findInvoiceInFR } from '@/lib/helcimBridge';

export const STAX_BASE = 'https://apiprod.fattlabs.com';

export function staxHeaders() {
  const key = process.env.STAX_API_KEY;
  if (!key) throw new Error('STAX_API_KEY not set');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
}

// Map a Stax transaction's payment method to FR's payment-method code (3=Card, 4=ACH).
export function frPaymentMethodFromStax(txn: any): number {
  const method = String(txn?.method || txn?.payment_method?.method || '').toLowerCase();
  if (method === 'bank' || method === 'ach' || method === 'echeck') return 4;
  return 3; // card (default)
}

// Pull the FR invoice number we stamped onto the Stax transaction/payment-method meta at creation time.
function frInvoiceFromStax(txn: any): string | null {
  // We set meta.fr_invoice when creating the charge/link/invoice. Check the common locations.
  return (
    txn?.meta?.fr_invoice ||
    txn?.meta?.invoice_number ||
    txn?.invoice?.meta?.fr_invoice ||
    txn?.payment_method?.meta?.fr_invoice ||
    null
  );
}

type StaxResult = { status: string; reason?: string };

// Issue a refund (or void) for a Stax transaction via the API. Stax's /void-or-refund voids if the txn is
// unsettled, refunds if settled. Pass `total` for a partial refund; omit for a full refund. Then records the
// refund back to FR as a NEGATIVE payment on the original invoice.
export async function refundStaxTransaction(staxTransactionId: string, opts: { total?: number; frInvoice?: string } = {}): Promise<{ ok: boolean; status: string; detail?: any; frPaymentId?: string | null }> {
  const headers = staxHeaders();
  // 1) Fetch the original txn (for amount + FR invoice from meta, and to validate).
  const getRes = await fetch(`${STAX_BASE}/transaction/${staxTransactionId}`, { headers });
  const orig = await getRes.json().catch(() => null);
  if (!getRes.ok || !orig?.id) return { ok: false, status: 'txn_not_found', detail: orig };
  const alreadyRefunded = Number(orig.total_refunded || 0);
  const origTotal = Number(orig.total || 0);
  const frInvoice = opts.frInvoice || orig?.meta?.fr_invoice || null;

  // 2) Issue the refund/void.
  const body: any = {};
  if (opts.total && opts.total > 0) body.total = Number(opts.total.toFixed(2));
  const refRes = await fetch(`${STAX_BASE}/transaction/${staxTransactionId}/void-or-refund`, {
    method: 'POST', headers, body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });
  const refJson = await refRes.json().catch(() => null);
  if (!refRes.ok) return { ok: false, status: 'refund_failed', detail: refJson };

  const refundAmount = opts.total && opts.total > 0 ? opts.total : (origTotal - alreadyRefunded);

  // 3) Record the refund to FR as a negative payment on the original invoice (if we can match it).
  let frPaymentId: string | null = null;
  if (frInvoice) {
    const inv = await findInvoiceInFR(String(frInvoice));
    if (inv) {
      const cfg = FR_OFFICES[inv.office];
      const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
      const ref = `STAX-REFUND-${staxTransactionId}`;
      // FR records a refund as a negative-amount payment, doCharge=0 (external processor did the refund).
      const qs = `doCharge=0&customerID=${inv.customerID}&amount=-${refundAmount.toFixed(2)}&paymentMethod=3&notes=${encodeURIComponent(ref)}`;
      try {
        const r = await fetch(`${FR_BASE}/payment/create?authenticationKey=${cfg.key}&authenticationToken=${cfg.token}&${qs}`);
        const j = await r.json();
        frPaymentId = (j?.paymentID || j?.paymentIDs?.[0]) ? String(j.paymentID || j.paymentIDs[0]) : null;
      } catch { /* non-fatal — refund succeeded on Stax regardless */ }
    }
  }

  return { ok: true, status: 'refunded', refundAmount, frInvoice, frPaymentId, detail: refJson } as any;
}

// Process one Stax transaction (from webhook or poll). Idempotent via the stax_payments ledger.
export async function processStaxTransaction(txn: any, source: 'webhook' | 'poll'): Promise<StaxResult> {
  const staxTransactionId = String(txn?.id || txn?.transaction_id || '');
  if (!staxTransactionId) return { status: 'skipped', reason: 'no stax transaction id' };
  const amount = typeof txn?.total === 'string' ? parseFloat(txn.total) : Number(txn?.total ?? 0);
  const type = String(txn?.type || '').toLowerCase(); // 'charge' | 'refund' | 'void' | 'credit' | 'capture'
  const success = txn?.success === true || String(txn?.status || '').toLowerCase() === 'approved' || txn?.is_captured === 1 || txn?.is_captured === true;

  // 1) DEDUP
  const existing = await prisma.staxPayment.findUnique({ where: { staxTransactionId } }).catch(() => null);
  if (existing && existing.status === 'written') return { status: 'already_written' };

  const base = {
    amount: amount || 0,
    currency: 'USD',
    cardType: txn?.payment_method?.card_type || txn?.card_type || null,
    cardHolderName: txn?.payment_method?.person_name || txn?.person_name || null,
    staxType: type || null,
    staxStatus: String(txn?.status || (success ? 'approved' : 'unknown')),
    staxCustomerId: txn?.customer_id || txn?.customer?.id || null,
    frInvoiceNumber: frInvoiceFromStax(txn),
    staxCreatedAt: txn?.created_at ? new Date(txn.created_at) : null,
    source,
  };
  const ledger = await prisma.staxPayment.upsert({
    where: { staxTransactionId },
    create: { staxTransactionId, status: 'pending', ...base },
    update: { ...base },
  });

  const fail = async (reason: string, status = 'failed'): Promise<StaxResult> => {
    await prisma.staxPayment.update({ where: { id: ledger.id }, data: { status, failReason: reason, processedAt: new Date() } }).catch(() => {});
    return { status, reason };
  };

  // 2a) REFUND/VOID coming from Stax (done outside the Hub) → record a NEGATIVE payment to FR, then stop.
  if (type === 'refund' || type === 'void' || type === 'credit' || txn?.is_refund === 1 || txn?.is_voided === 1) {
    const frInvoiceR = frInvoiceFromStax(txn);
    if (!frInvoiceR) return fail('refund with no fr_invoice — cannot match to FR', 'flagged');
    const invR = await findInvoiceInFR(String(frInvoiceR));
    if (!invR) return fail(`refund: FR invoice ${frInvoiceR} not found`, 'flagged');
    const cfgR = FR_OFFICES[invR.office];
    const FR_BASE_R = 'https://critterstoppest.fieldroutes.com/api';
    const refAmt = Math.abs(amount) || Math.abs(Number(txn?.total_refunded || 0));
    const refRef = `STAX-REFUND-${staxTransactionId}`;
    try {
      await fetch(`${FR_BASE_R}/payment/create?authenticationKey=${cfgR.key}&authenticationToken=${cfgR.token}&doCharge=0&customerID=${invR.customerID}&amount=-${refAmt.toFixed(2)}&paymentMethod=${frPaymentMethodFromStax(txn)}&notes=${encodeURIComponent(refRef)}`);
    } catch (e: any) { return fail(`refund FR write threw: ${String(e).slice(0, 120)}`); }
    await prisma.staxPayment.update({ where: { id: ledger.id }, data: { status: 'written', office: invR.office, frCustomerId: invR.customerID, staxType: 'refund', failReason: null, processedAt: new Date() } }).catch(() => {});
    return { status: 'written', reason: 'refund recorded' };
  }

  // 2) VALIDATE — only record successful CHARGES with a real amount + an FR invoice.
  if (type && type !== 'charge' && type !== 'capture') return fail(`type=${type} (only charge/capture/refund recorded)`, 'skipped');
  if (!success) return fail(`not approved (status=${txn?.status})`, 'skipped');
  if (!amount || amount <= 0) return fail('amount <= 0', 'skipped');
  const frInvoice = frInvoiceFromStax(txn);
  if (!frInvoice) return fail('no fr_invoice on Stax txn meta — cannot match to FR', 'flagged');

  const inv = await findInvoiceInFR(String(frInvoice));
  if (!inv) return fail(`FR invoice ${frInvoice} not found in any office`, 'flagged');

  // 3) WRITE to FR — record-only (doCharge=0), correct method, referenced by Stax txn id.
  const cfg = FR_OFFICES[inv.office];
  const method = frPaymentMethodFromStax(txn);
  const ref = `STAX-${staxTransactionId}`;
  // Card last-four + type from the Stax payment method (FR persists both `lastFour` and `cardType` — verified).
  const pm = txn?.payment_method || {};
  const lastFour = pm.card_last_four || txn?.card_last_four || pm.bin_type || '';
  const cardType = pm.card_type || txn?.card_type || '';
  // FR's payment/create ignores transactionID + checkNumber on a doCharge=0 recorded payment (they're
  // read-only / gateway-only), but it DOES persist `notes`, `lastFour`, and `cardType` — verified. So the Stax
  // reference goes in notes, plus the real card last-four + type for a complete record.
  let qs = `doCharge=0&customerID=${inv.customerID}&amount=${amount.toFixed(2)}&paymentMethod=${method}&notes=${encodeURIComponent(ref)}`;
  if (lastFour) qs += `&lastFour=${encodeURIComponent(String(lastFour).slice(-4))}`;
  if (cardType) qs += `&cardType=${encodeURIComponent(cardType)}`;
  const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
  let frPaymentId: string | null = null;
  try {
    const r = await fetch(`${FR_BASE}/payment/create?authenticationKey=${cfg.key}&authenticationToken=${cfg.token}&${qs}`);
    const j = await r.json();
    if (j?.success === false) return fail(`FR error: ${j?.errorMessage || 'unknown'}`);
    frPaymentId = (j?.paymentID || j?.paymentIDs?.[0]) ? String(j.paymentID || j.paymentIDs[0]) : null;
    if (!frPaymentId) {
      // Fallback: FR create doesn't always return the id — find it by this customer's newest payment with our ref.
      try {
        const srch = await fetch(`${FR_BASE}/payment/search?customerIDs=${inv.customerID}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`);
        const sj = await srch.json();
        const ids: number[] = (sj.paymentIDs || []).map(Number).sort((a: number, b: number) => b - a).slice(0, 10);
        if (ids.length) {
          const g = await fetch(`${FR_BASE}/payment/get?paymentIDs=${ids.join(',')}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`);
          const gj = await g.json();
          const match = (gj.payments || []).find((p: any) => String(p.notes) === ref);
          if (match) frPaymentId = String(match.paymentID);
        }
      } catch { /* non-fatal */ }
    }
  } catch (e: any) {
    return fail(`FR write threw: ${String(e).slice(0, 150)}`);
  }

  // 4) RECORD success.
  await prisma.staxPayment.update({
    where: { id: ledger.id },
    data: { status: 'written', office: inv.office, frCustomerId: inv.customerID, frPaymentId, frPaymentMethod: method, failReason: null, processedAt: new Date() },
  });

  // 5) Auto-flip any matching payment link (same FR invoice #) to Paid — the webhook carries the invoice #, and
  //    so does the link, so we sync them automatically. No manual sync needed.
  try {
    await prisma.paymentLinkRequest.updateMany({
      where: { frInvoiceNumber: String(frInvoice), status: { in: ['sent', 'viewed'] } },
      data: { status: 'paid', paidAt: new Date(), helcimTransactionId: staxTransactionId },
    });
  } catch { /* non-fatal — payment is recorded regardless */ }

  return { status: 'written' };
}
