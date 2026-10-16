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

  // DEDUP: mark this refund as handled-by-Hub so the inbound webhook (which WILL fire for this same refund)
  // doesn't double-process it. We write TWO markers:
  //  (a) keyed by the original txn id (refund:<orig>) — legacy/parent-based match
  //  (b) keyed by the ACTUAL refund transaction's own id (from the Stax response) — so the webhook matches
  //      directly on its staxTransactionId, with no reliance on the parent_transaction field (which varies).
  const refundTxnId = refJson?.id || refJson?.transaction?.id || null; // the new refund transaction's id
  const refundLedgerId = `refund:${staxTransactionId}`;
  await prisma.staxPayment.upsert({
    where: { staxTransactionId: refundLedgerId },
    create: { staxTransactionId: refundLedgerId, amount: -refundAmount, staxType: 'refund', status: 'written', frInvoiceNumber: frInvoice, source: 'hub', processedAt: new Date() },
    update: { status: 'written', processedAt: new Date() },
  }).catch(() => {});
  if (refundTxnId) {
    // This row makes the webhook's own-id dedup check hit immediately.
    await prisma.staxPayment.upsert({
      where: { staxTransactionId: String(refundTxnId) },
      create: { staxTransactionId: String(refundTxnId), amount: -refundAmount, staxType: 'refund', status: 'written', frInvoiceNumber: frInvoice, source: 'hub', processedAt: new Date() },
      update: { status: 'written', staxType: 'refund', source: 'hub', processedAt: new Date() },
    }).catch(() => {});
  }

  // Reverse the refund in FR using payment/createRefund against the ORIGINAL payment (proper linked reversal —
  // applies against the original, not a disconnected negative line). We need the original FR paymentID, which
  // we stored on the charge's ledger row (frPaymentId).
  let frPaymentId: string | null = null;
  let matched = false;
  const origLedger = await prisma.staxPayment.findUnique({ where: { staxTransactionId } }).catch(() => null);
  const origFrPaymentId = origLedger?.frPaymentId || null;
  const office = origLedger?.office || (frInvoice ? (await findInvoiceInFR(String(frInvoice)))?.office : null) || null;
  if (origFrPaymentId && office && FR_OFFICES[office]) {
    const cfg = FR_OFFICES[office];
    const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
    // createRefund: paymentID (required) refunds the original; add amount for partial (full if omitted).
    let qs = `paymentID=${origFrPaymentId}`;
    if (opts.total && opts.total > 0) qs += `&amount=${opts.total.toFixed(2)}`;
    try {
      const r = await fetch(`${FR_BASE}/payment/createRefund?authenticationKey=${cfg.key}&authenticationToken=${cfg.token}&${qs}`);
      const j = await r.json();
      if (j?.success !== false) { matched = true; frPaymentId = origFrPaymentId; }
    } catch { /* non-fatal — Stax refund succeeded regardless */ }
  }
  // Mark the refund ledger row written (so webhook skips it regardless of match outcome).
  await prisma.staxPayment.update({ where: { staxTransactionId: refundLedgerId }, data: { status: 'written', frPaymentId, office: null, processedAt: new Date() } }).catch(() => {});

  // Send the customer a REFUND RECEIPT. Stax auto-sends a receipt on a sale but NOT on a refund, so we trigger
  // it: PUT /transaction/{refundTxnId}/receipt/email. Use the refund transaction's own id.
  let receiptSent = false;
  if (refundTxnId) {
    try {
      const rc = await fetch(`${STAX_BASE}/transaction/${refundTxnId}/receipt/email`, { method: 'PUT', headers });
      receiptSent = rc.ok;
    } catch { /* non-fatal — refund succeeded regardless */ }
  }

  return { ok: true, status: 'refunded', refundAmount, frInvoice, matched, frPaymentId, receiptSent, detail: refJson } as any;
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

  // 2a) REFUND/VOID coming from Stax → record a NEGATIVE payment to FR, then stop.
  if (type === 'refund' || type === 'void' || type === 'credit' || txn?.is_refund === 1 || txn?.is_voided === 1) {
    // DEDUP: if the Hub issued this refund (via refundStaxTransaction), it already wrote the FR negative payment.
    // The refund is keyed by the ORIGINAL transaction id. A Stax refund txn references its parent via
    // parent_transaction / child_captures; check both the refund's own id and its parent for a Hub ledger row.
    // DEDUP: check (a) this refund txn's OWN id, and (b) refund:<parent> markers. The Hub writes a marker under
    // the refund's own id when it issues a refund, so this matches directly without needing the parent field.
    const parentId = txn?.parent_transaction || txn?.parent_transaction_id || null;
    const refundKeys = [staxTransactionId, `refund:${staxTransactionId}`, parentId ? `refund:${parentId}` : null].filter(Boolean) as string[];
    const already = await prisma.staxPayment.findFirst({ where: { staxTransactionId: { in: refundKeys }, status: 'written', staxType: 'refund' } }).catch(() => null);
    if (already) return { status: 'already_written', reason: 'refund already handled by Hub' };

    // Find the ORIGINAL charge's FR paymentID (from its ledger row) to reverse via createRefund.
    const origRow = parentId ? await prisma.staxPayment.findUnique({ where: { staxTransactionId: String(parentId) } }).catch(() => null) : null;
    const origFrPmt = origRow?.frPaymentId || null;
    const origOffice = origRow?.office || null;
    if (!origFrPmt || !origOffice || !FR_OFFICES[origOffice]) {
      // Can't match the original — but the Stax refund DID succeed. If the Hub likely issued it (common case),
      // don't raise a false "needs manual action" flag; mark skipped. Only genuinely-external refunds with no
      // trace warrant attention, so use 'skipped' not 'flagged' to avoid false alarms on refunds that worked.
      return fail(`refund: could not auto-match original FR payment (parent ${parentId || 'unknown'}); verify FR if this was an external refund`, 'skipped');
    }
    const cfgR = FR_OFFICES[origOffice];
    const FR_BASE_R = 'https://critterstoppest.fieldroutes.com/api';
    const refAmt = Math.abs(amount) || Math.abs(Number(txn?.total_refunded || 0));
    try {
      let qs = `paymentID=${origFrPmt}`;
      if (refAmt > 0) qs += `&amount=${refAmt.toFixed(2)}`;
      const r = await fetch(`${FR_BASE_R}/payment/createRefund?authenticationKey=${cfgR.key}&authenticationToken=${cfgR.token}&${qs}`);
      const j = await r.json();
      if (j?.success === false) return fail(`refund createRefund error: ${j?.errorMessage || 'unknown'}`);
    } catch (e: any) { return fail(`refund FR write threw: ${String(e).slice(0, 120)}`); }
    await prisma.staxPayment.update({ where: { id: ledger.id }, data: { status: 'written', office: origOffice, staxType: 'refund', failReason: null, processedAt: new Date() } }).catch(() => {});
    return { status: 'written', reason: 'refund reversed via createRefund' };
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
  // Apply the payment to the SPECIFIC invoice it was for (ticketID) — otherwise FR applies it to the oldest
  // open invoice (which misapplied a 276345 payment to 276344). frInvoice is the FR ticket id from meta.
  let qs = `doCharge=0&customerID=${inv.customerID}&amount=${amount.toFixed(2)}&paymentMethod=${method}&notes=${encodeURIComponent(ref)}`;
  if (frInvoice) qs += `&ticketID=${encodeURIComponent(String(frInvoice))}`;
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
