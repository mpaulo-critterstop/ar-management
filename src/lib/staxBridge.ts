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

  // 2) VALIDATE — only record successful CHARGES (not refunds/voids/pre-auths) with a real amount + an FR invoice.
  if (type && type !== 'charge' && type !== 'capture') return fail(`type=${type} (only charge/capture recorded here)`, 'skipped');
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
  const qs = `doCharge=0&customerID=${inv.customerID}&amount=${amount.toFixed(2)}&paymentMethod=${method}&checkNumber=${encodeURIComponent(ref)}`;
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
          const match = (gj.payments || []).find((p: any) => String(p.checkNumber) === ref);
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
  return { status: 'written' };
}
