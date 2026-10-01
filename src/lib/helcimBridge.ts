// Shared Helcim -> FR bridge logic. Both the webhook and the polling cron call processHelcimTransaction()
// so they behave identically: dedup via the ledger, validate against FR, write with doCharge=0, record result.
import { prisma } from '@/lib/prisma';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
// Per-office FR creds. The bridge writes to whichever office owns the referenced invoice.
export const FR_OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

// Map a Helcim transaction type -> FR paymentMethod code (1 Cash, 2 Check, 3 Card, 4 ACH).
export function frPaymentMethod(helcimType: string | undefined): number {
  const t = String(helcimType || '').toLowerCase();
  if (t.includes('ach') || t.includes('bank') || t.includes('withdraw')) return 4; // ACH
  return 3; // default: Card (purchase/preauth/capture are card)
}

type HelcimTxn = {
  transactionId: number | string;
  amount: number | string;
  currency?: string;
  type?: string;
  status?: string;
  cardType?: string;
  cardHolderName?: string;
  customerCode?: string;
  invoiceNumber?: string;
  dateCreated?: string;
};

// Find which FR office owns a given invoice (ticket) number, returning office + customerID + balance.
async function findInvoiceInFR(invoiceNumber: string): Promise<{ office: string; customerID: string; balance: number } | null> {
  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!cfg.key) continue;
    try {
      const r = await fetch(`${FR_BASE}/ticket/get?ticketIDs=${invoiceNumber},${invoiceNumber}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`);
      const j = await r.json();
      const tk = (j.tickets || [])[0];
      if (tk && String(tk.ticketID) === String(invoiceNumber)) {
        return { office, customerID: String(tk.customerID), balance: parseFloat(tk.balance || '0') };
      }
    } catch { /* try next office */ }
  }
  return null;
}

// Process ONE Helcim transaction into FR. Idempotent: safe to call repeatedly for the same txn.
// Returns the ledger row's resulting status.
export async function processHelcimTransaction(txn: HelcimTxn, source: 'webhook' | 'poll'): Promise<{ status: string; reason?: string }> {
  const helcimTransactionId = String(txn.transactionId);
  const amount = typeof txn.amount === 'string' ? parseFloat(txn.amount) : txn.amount;

  // 1) DEDUP — if we've already seen this txn and it's been written, do nothing.
  const existing = await prisma.helcimPayment.findUnique({ where: { helcimTransactionId } });
  if (existing && existing.status === 'written') return { status: 'already_written' };

  // Upsert a ledger row (pending) so we have a record even if the write fails.
  const base = {
    amount: amount || 0, currency: txn.currency || null, cardType: txn.cardType || null,
    cardHolderName: txn.cardHolderName || null, helcimType: txn.type || null, helcimStatus: txn.status || null,
    helcimCustomerCode: txn.customerCode || null, helcimInvoiceNumber: txn.invoiceNumber || null,
    helcimDateCreated: txn.dateCreated ? new Date(txn.dateCreated) : null, source,
  };
  const ledger = await prisma.helcimPayment.upsert({
    where: { helcimTransactionId },
    create: { helcimTransactionId, status: 'pending', ...base },
    update: { ...base },
  });

  const fail = async (reason: string, status = 'failed') => {
    await prisma.helcimPayment.update({ where: { id: ledger.id }, data: { status, failReason: reason, processedAt: new Date() } });
    return { status, reason };
  };

  // 2) VALIDATE — only write APPROVED payments with a real amount + an invoice that exists in FR.
  if (String(txn.status || '').toUpperCase() !== 'APPROVED') return fail(`not approved (status=${txn.status})`, 'skipped');
  if (!amount || amount <= 0) return fail('amount <= 0', 'skipped');
  if (!txn.invoiceNumber) return fail('no invoiceNumber on Helcim txn — cannot match to FR', 'flagged');

  const inv = await findInvoiceInFR(String(txn.invoiceNumber));
  if (!inv) return fail(`FR invoice ${txn.invoiceNumber} not found in any office`, 'flagged');

  // 3) WRITE to FR — record-only (doCharge=0), correct payment method, referenced by Helcim txn id.
  const cfg = FR_OFFICES[inv.office];
  const method = frPaymentMethod(txn.type);
  const ref = `HELCIM-${helcimTransactionId}`;
  const qs = `doCharge=0&customerID=${inv.customerID}&amount=${amount.toFixed(2)}&paymentMethod=${method}&checkNumber=${encodeURIComponent(ref)}`;
  let frPaymentId: string | null = null;
  try {
    const r = await fetch(`${FR_BASE}/payment/create?authenticationKey=${cfg.key}&authenticationToken=${cfg.token}&${qs}`);
    const j = await r.json();
    if (j?.success === false) return fail(`FR error: ${j?.errorMessage || 'unknown'}`);
    frPaymentId = j?.paymentID || j?.paymentIDs?.[0] ? String(j.paymentID || j.paymentIDs[0]) : null;
    // Fallback: FR create doesn't always return the id. Look it up by this customer's newest payment
    // matching our amount + reference (checkNumber = HELCIM-<txnId>), so the audit trail is complete.
    if (!frPaymentId) {
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
      } catch { /* non-fatal — payment still recorded, just no id captured */ }
    }
  } catch (e: any) {
    return fail(`FR write threw: ${String(e).slice(0, 150)}`);
  }

  // 4) RECORD success.
  await prisma.helcimPayment.update({
    where: { id: ledger.id },
    data: { status: 'written', office: inv.office, frCustomerId: inv.customerID, frPaymentId, frPaymentMethod: method, failReason: null, processedAt: new Date() },
  });
  return { status: 'written' };
}
