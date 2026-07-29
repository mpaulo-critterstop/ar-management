// src/app/api/sync/auto/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { healPlaceholderCustomers } from '@/lib/healPlaceholderCustomers';
import { prisma } from '@/lib/prisma';

// AR Follow-up webhooks
const AR_FOLLOWUP_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/804c863a-a07d-4e18-804d-ab399061cdf9';
const AR_PARTIAL_WEBHOOK  = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/AM0p0PhEMlKoBozA9FnB';
const AR_PAID_WEBHOOK     = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/rlu6JwusY1H2fUXOrMli';

// ============================================================
// OFFICE CONFIGURATION
// ============================================================
const OFFICES = {
  DFW: {
    key: process.env.FIELDROUTES_KEY_DFW!,
    token: process.env.FIELDROUTES_TOKEN_DFW!,
    officeId: '1',
  },
  ATX: {
    key: process.env.FIELDROUTES_KEY_ATX!,
    token: process.env.FIELDROUTES_TOKEN_ATX!,
    officeId: '5',
  },
  OKC: {
    key: process.env.FIELDROUTES_KEY_OKC!,
    token: process.env.FIELDROUTES_TOKEN_OKC!,
    officeId: '3',
  },
  CStat: {
    key: process.env.FIELDROUTES_KEY_CSTAT!,
    token: process.env.FIELDROUTES_TOKEN_CSTAT!,
    officeId: '4',
  },
};

// ============================================================
// SERVICE ID CLASSIFICATION
// ============================================================

const CLOSEOUT_SERVICE_IDS = new Set([
  0, 553, 720, 510, 501, 624, 542, 541, 479, 674,
]);

const WILDLIFE_SERVICE_IDS = new Set([
  533, 538, 509, 1065, 1060, 719, 1064, 1061,
  615, 671, 546, 620, 554, 687, 688,
  677, 619, 682, 496, 1058, 544, 487,
  683, 631, 526, 1062, 636, 504,
  1059, 1063, 189, 287, 685, 690, 691, 684, 489,
  670, 485, 614, 502, 609, 520, 678, 517, 645, 686, 1037,
  746, 884,
  710, 705, 715, 716, 717, 722, 724, 725, 726, 727,
]);

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 1000;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getServiceType(serviceId: number): string {
  if (CLOSEOUT_SERVICE_IDS.has(serviceId)) return 'Wildlife';
  if (WILDLIFE_SERVICE_IDS.has(serviceId)) return 'Wildlife';
  return 'Pest Control';
}

function getDueDate(serviceId: number, invoiceDate: string): Date | null {
  if (CLOSEOUT_SERVICE_IDS.has(serviceId)) return null;
  return new Date(invoiceDate);
}

function getInvoiceStatus(balance: number, due: Date | null): string {
  if (balance === 0) return 'PAID';
  if (due && due < new Date()) return 'OVERDUE';
  return 'CURRENT';
}

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchInBatches(
  endpoint: string,
  idParam: string,
  ids: number[],
  key: string,
  token: string
): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE).join(',');
    const data = await frFetch(endpoint, `${idParam}=${batch}`, key, token);
    const propertyName = data.propertyName;
    if (data.success && propertyName && data[propertyName]) {
      results.push(...data[propertyName]);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  return results;
}

// ============================================================
// PROCESS SINGLE TICKET — shared logic for all sync paths
// ============================================================

async function processTicket(
  t: any,
  office: string,
  created: { count: number },
  updated: { count: number },
  errors: { count: number }
) {
  try {
    if (parseFloat(t.total) === 0) {
      await prisma.invoice.updateMany({
        where: { externalId: String(t.ticketID), office },
        data: { status: 'PAID', paid: 0, amount: 0 },
      });
      const voidedInvoice = await prisma.invoice.findFirst({
        where: { externalId: String(t.ticketID), office },
      });
      if (voidedInvoice) {
        // Revert primary lead
        await prisma.lead.updateMany({
          where: { invoiceId: voidedInvoice.id },
          data: { status: 'INSPECTED', invoiceId: null, amount: null },
        });
        // Clear upsell if this was an upsell invoice
        await prisma.lead.updateMany({
          where: { upsellInvoiceId: voidedInvoice.id },
          data: { upsellInvoiceId: null, upsellAmount: null, upsellDate: null },
        });
      }
      return;
    }

    if (t.active !== '1') {
      await prisma.invoice.updateMany({
        where: { externalId: String(t.ticketID), office },
        data: { status: 'PAID', paid: parseFloat(t.total), amount: parseFloat(t.total) },
      });
      const inactiveInvoice = await prisma.invoice.findFirst({
        where: { externalId: String(t.ticketID), office },
      });
      if (inactiveInvoice) {
        // Revert primary lead to INSPECTED
        await prisma.lead.updateMany({
          where: { invoiceId: inactiveInvoice.id },
          data: { status: 'INSPECTED', invoiceId: null, amount: null },
        });
        // Clear upsell if this was an upsell invoice
        await prisma.lead.updateMany({
          where: { upsellInvoiceId: inactiveInvoice.id },
          data: { upsellInvoiceId: null, upsellAmount: null, upsellDate: null },
        });
      }
      return;
    }

    const officeId = OFFICES[office as keyof typeof OFFICES].officeId;
    if (t.officeID !== officeId && t.officeID !== '-1') return;

    const resolvedCustomerID =
      t.billToAccountID !== '0' && t.billToAccountID !== t.customerID
        ? t.billToAccountID
        : t.customerID;

    const invoiceDate = t.invoiceDate || t.dateCreated;
    const serviceId = parseInt(t.serviceID);
    const serviceType = getServiceType(serviceId);
    const due = getDueDate(serviceId, invoiceDate);
    const amount = parseFloat(t.total);
    const balance = parseFloat(t.balance);
    const paid = Math.max(0, amount - balance);
    const status = getInvoiceStatus(balance, due);

    let customer = await prisma.customer.findFirst({
      where: { externalId: String(resolvedCustomerID), office },
    });
    if (!customer) {
      customer = await prisma.customer.findFirst({
        where: { externalId: String(resolvedCustomerID) },
      });
    }
    if (!customer && String(resolvedCustomerID) !== String(t.customerID)) {
      customer = await prisma.customer.findFirst({
        where: { externalId: String(t.customerID), office },
      });
      if (!customer) {
        customer = await prisma.customer.findFirst({
          where: { externalId: String(t.customerID) },
        });
      }
    }
    if (!customer) {
      try {
        customer = await prisma.customer.create({
          data: {
            name: `Customer ${resolvedCustomerID}`,
            externalId: String(resolvedCustomerID),
            externalSource: 'fieldroutes',
            office,
            status: 'ACTIVE',
            terms: 'Net 30',
          },
        });
      } catch {
        errors.count++;
        return;
      }
    }

    const invoiceData = {
      customerId: customer.id,
      date: new Date(invoiceDate),
      due,
      amount,
      paid,
      status: status as any,
      serviceType,
      serviceId,
      office,
      externalId: String(t.ticketID),
      externalSource: 'fieldroutes',
    };

    // Preserve existing due date — dispatch sync sets due = closeout date
    // and AR sync must not overwrite it back to null
    const existingInvoice = await prisma.invoice.findFirst({
      where: { externalId: String(t.ticketID) },
      select: { due: true, paid: true, amount: true, arFollowupSent: true },
    });
    const preservedDue = existingInvoice?.due ?? invoiceData.due;
    const updateData = {
      ...invoiceData,
      due: preservedDue,
      status: getInvoiceStatus(balance, preservedDue) as any,
    };

    const result = await prisma.invoice.upsert({
      where: { id: String(t.ticketID) },
      update: updateData,
      create: { id: String(t.ticketID), ...invoiceData },
    });

    const isNew = !existingInvoice;
    if (isNew) {
      created.count++;
      // Auto-attach as upsell if this is a FAR invoice for a customer with an existing SOLD lead
      const FAR_SERVICE_IDS       = new Set(['501', '674', '479', '541', '542', '624']);
      const EXCLUSION_SERVICE_IDS = new Set(['553', '716', '720']);
      const ALL_UPSELL_IDS        = new Set([...FAR_SERVICE_IDS, ...EXCLUSION_SERVICE_IDS]);

      if (ALL_UPSELL_IDS.has(String(serviceId)) && amount > 0) {
        const existingLead = await prisma.lead.findFirst({
          where: { customerId: customer.id, status: 'SOLD', upsellInvoiceId: null },
          orderBy: { inspectionDate: 'desc' },
        });
        if (existingLead && existingLead.invoiceId !== result.id) {
          // For exclusion invoices, only upsell if in a different month than inspection
          let shouldAttach = true;
          if (EXCLUSION_SERVICE_IDS.has(String(serviceId)) && existingLead.inspectionDate) {
            const invoiceMonth = new Date(invoiceDate).getMonth() + '-' + new Date(invoiceDate).getFullYear();
            const inspectionMonth = new Date(existingLead.inspectionDate).getMonth() + '-' + new Date(existingLead.inspectionDate).getFullYear();
            if (invoiceMonth === inspectionMonth) shouldAttach = false;
          }
          if (shouldAttach) {
            await prisma.lead.update({
              where: { id: existingLead.id },
              data: {
                upsellInvoiceId: result.id,
                upsellAmount: amount,
                upsellDate: new Date(invoiceDate),
              },
            });
          }
        }
      }
    } else {
      updated.count++;
      // Sync lead amount if this invoice is linked as primary or upsell and amount changed
      if (amount > 0) {
        await prisma.lead.updateMany({
          where: { invoiceId: result.id },
          data: { amount },
        });
        await prisma.lead.updateMany({
          where: { upsellInvoiceId: result.id },
          data: { upsellAmount: amount },
        });
      }

      // Fire AR follow-up webhooks only if customer is in the sequence
      if (existingInvoice?.arFollowupSent) {
        const prevPaid   = Number(existingInvoice?.paid ?? 0);
        const prevAmount = Number((existingInvoice as any)?.amount ?? 0);
        const newPaid    = paid;
        const amountDue  = Math.max(0, amount - newPaid);

        const customer = await prisma.customer.findUnique({
          where: { id: result.customerId },
          select: { name: true, phone: true, email: true, serviceAddr: true, externalId: true },
        });
        const nameParts = (customer?.name || '').trim().split(' ');
        const basePayload = {
          fname:         nameParts[0] || '',
          lname:         nameParts.slice(1).join(' ') || '',
          phone1:        (customer?.phone || '').replace(/\D/g, ''),
          email:         customer?.email || '',
          address:       customer?.serviceAddr || '',
          invoiceNumber: result.externalId || result.id,
          invoiceAmount: amount.toFixed(2),
          amountDue:     amountDue.toFixed(2),
          dueDate:       result.due ? result.due.toISOString().split('T')[0] : '',
          officeName:    result.office || '',
          customerID:    customer?.externalId || result.customerId,
        };

        if (newPaid > prevPaid) {
          // Payment received
          if (amountDue <= 0) {
            // Paid in full — remove from sequence
            await fetch(AR_PAID_WEBHOOK, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...basePayload, event: 'paid_in_full' }),
            }).catch(() => {});
          } else {
            // Partial payment — restart sequence with new balance
            await fetch(AR_PARTIAL_WEBHOOK, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...basePayload, event: 'partial_payment' }),
            }).catch(() => {});
          }
        } else if (amount < prevAmount && newPaid === prevPaid) {
          // Discount applied — update contact balance but stay in sequence
          await fetch(AR_FOLLOWUP_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...basePayload, event: 'balance_updated' }),
          }).catch(() => {});
        }
      }
    }
  } catch {
    errors.count++;
  }
}

// ============================================================
// SYNC CUSTOMERS
// ============================================================

async function syncCustomers(
  office: string,
  key: string,
  token: string,
  fromDate?: string
): Promise<{ created: number; updated: number; errors: number }> {
  let created = 0, updated = 0, errors = 0;

  const searchParams = fromDate ? `dateUpdated=${fromDate}` : '';
  const searchData = await frFetch('customer/search', searchParams, key, token);
  if (!searchData.success) throw new Error('Customer search failed');
  const allIds: number[] = searchData.customerIDs || [];

  const existing = await prisma.customer.findMany({
    where: { office, externalId: { not: null } },
    select: { externalId: true, id: true },
  });
  const existingMap = new Map(existing.map((c: any) => [c.externalId!, c.id]));

  const customers = await fetchInBatches('customer/get', 'customerIDs', allIds, key, token);

  for (const c of customers) {
    try {
      if (c.officeID !== OFFICES[office as keyof typeof OFFICES].officeId) continue;

      const name = c.companyName?.trim()
        ? c.companyName.trim()
        : `${c.fname || ''} ${c.lname || ''}`.trim();

      const serviceAddr = [c.address, c.city, c.state, c.zip]
        .filter(Boolean)
        .join(', ');

      // Multi-property / commercial detection → exclude these from AR automation (residential only).
      const custId = String(c.customerID);
      const commercial = c.commercialAccount === 1 || c.commercialAccount === '1';
      const masterRaw = String(c.masterAccount ?? '0');
      const hasMaster = masterRaw !== '0' && masterRaw !== '' && masterRaw !== custId;
      const billToRaw = String(c.billToAccountID ?? custId);
      const billsElsewhere = billToRaw !== '0' && billToRaw !== '' && billToRaw !== custId;
      const excludeFromAutomation = commercial || hasMaster || billsElsewhere;

      const customerData = {
        name,
        email: c.email || null,
        phone: c.phone1 || null,
        serviceAddr: serviceAddr || null,
        office,
        externalId: String(c.customerID),
        externalSource: 'fieldroutes',
        status: 'ACTIVE' as const,
        commercialAccount: commercial,
        masterAccountId: hasMaster ? masterRaw : null,
        billToAccountId: billsElsewhere ? billToRaw : null,
        excludeFromAutomation,
      };

      const existingId = existingMap.get(String(c.customerID));
      if (existingId) {
        await prisma.customer.update({ where: { id: existingId }, data: customerData });
        updated++;
      } else {
        await prisma.customer.upsert({
          where: { externalId_office: { externalId: String(c.customerID), office } },
          update: customerData,
          create: customerData,
        });
        created++;
      }
    } catch {
      errors++;
    }
  }

  return { created, updated, errors };
}

// ============================================================
// SYNC INVOICES
// ============================================================

async function syncInvoices(
  office: string,
  key: string,
  token: string,
  fullSync = false,
  fromDate?: string,
  specificIds?: number[],
  toDate?: string
): Promise<{ created: number; updated: number; errors: number }> {
  const created = { count: 0 };
  const updated = { count: 0 };
  const errors  = { count: 0 };

  // ── Path 1: Specific ticket IDs ──
  if (specificIds && specificIds.length > 0) {
    console.log(`[${office}] Syncing ${specificIds.length} specific ticket IDs`);
    const tickets = await fetchInBatches('ticket/get', 'ticketIDs', specificIds, key, token);
    for (const t of tickets) {
      await processTicket(t, office, created, updated, errors);
    }
    console.log(`[${office}] specific IDs complete: created=${created.count}, updated=${updated.count}, errors=${errors.count}`);
    return { created: created.count, updated: updated.count, errors: errors.count };
  }

  // ── Path 2: Full sync ──
  if (fullSync) {
    const searchData = await frFetch('ticket/search', '', key, token);
    if (!searchData.success) throw new Error('Ticket search failed');
    const allIds: number[] = searchData.ticketIDs || [];
    console.log(`[${office}] Total IDs: ${allIds.length} (fullSync=true)`);

    const CHUNK_SIZE = 5000;
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
      const chunk = allIds.slice(i, i + CHUNK_SIZE);
      console.log(`[${office}] Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(allIds.length / CHUNK_SIZE)} (${chunk.length} IDs)`);
      const tickets = await fetchInBatches('ticket/get', 'ticketIDs', chunk, key, token);
      for (const t of tickets) {
        await processTicket(t, office, created, updated, errors);
      }
    }
    console.log(`[${office}] fullSync complete: created=${created.count}, updated=${updated.count}, errors=${errors.count}`);
    return { created: created.count, updated: updated.count, errors: errors.count };
  }

  // ── Path 3: Incremental sync ──
  const lastSync = await prisma.syncLog.findFirst({
    where: { source: `fieldroutes_auto_${office}`, status: 'success' },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });
  // Incremental window. Start 1 day BEFORE the last successful sync as a safety buffer:
  // FR timestamps are US Central while completedAt is UTC, and same-day edits after the prior
  // run could otherwise fall in a gap. Overlap is harmless (upserts are idempotent).
  const rawFrom = fromDate || (lastSync?.completedAt
    ? lastSync.completedAt.toISOString().split('T')[0]
    : '2020-01-01');
  const dateFrom = fromDate
    ? rawFrom // manual runs use the exact date the caller asked for
    : (() => { const d = new Date(rawFrom); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();
  const dateTo = toDate || new Date().toISOString().split('T')[0];
  console.log(`[${office}] Incremental sync from: ${dateFrom} to: ${dateTo}`);

  let allIds: number[] = [];

  if (fromDate) {
    // Manual date range — collect IDs via invoiceDate + dateUpdated to catch new AND modified invoices
    const idSet = new Set<number>();

    // Pass 1: invoiceDate loop (catches new invoices)
    let current = new Date(dateFrom);
    const end = new Date(dateTo);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const data = await frFetch('ticket/search', `invoiceDate=${dateStr}`, key, token);
      if (data.success && data.ticketIDs) {
        data.ticketIDs.forEach((id: number) => idSet.add(id));
      }
      current.setDate(current.getDate() + 1);
      await new Promise(r => setTimeout(r, 150));
    }

    // Pass 2: dateUpdated loop (catches old invoices modified on these dates)
    let current2 = new Date(dateFrom);
    while (current2 <= end) {
      const dateStr = current2.toISOString().split('T')[0];
      const data = await frFetch('ticket/search', `dateUpdated=${dateStr}`, key, token);
      if (data.success && data.ticketIDs) {
        data.ticketIDs.forEach((id: number) => idSet.add(id));
      }
      current2.setDate(current2.getDate() + 1);
      await new Promise(r => setTimeout(r, 150));
    }

    allIds = Array.from(idSet);
    console.log(`[${office}] Total unique IDs (invoiceDate + dateUpdated): ${allIds.length}`);

  } else {
    // Cron path — scan BOTH invoiceDate AND dateUpdated over the window, then union.
    // dateUpdated alone MISSES new invoices whose invoiceDate is in-window but whose dateUpdated
    // timestamp falls on a different day (common in FR when the invoice/service date differs from
    // the finalize/update date). The invoiceDate pass catches those; the dateUpdated pass catches
    // old invoices modified in-window (payments, voids, refunds, edits). (Diagnosed 2026-07-29.)
    const idSet = new Set<number>();
    const end3 = new Date(dateTo);

    // Pass 1: invoiceDate loop — catches newly-created invoices.
    let cInv = new Date(dateFrom);
    while (cInv <= end3) {
      const dateStr = cInv.toISOString().split('T')[0];
      const data = await frFetch('ticket/search', `invoiceDate=${dateStr}`, key, token);
      if (data.success && data.ticketIDs) data.ticketIDs.forEach((id: number) => idSet.add(id));
      cInv.setDate(cInv.getDate() + 1);
      await new Promise(r => setTimeout(r, 150));
    }

    // Pass 2: dateUpdated loop — catches existing invoices modified in-window.
    let cUpd = new Date(dateFrom);
    while (cUpd <= end3) {
      const dateStr = cUpd.toISOString().split('T')[0];
      const data = await frFetch('ticket/search', `dateUpdated=${dateStr}`, key, token);
      if (data.success && data.ticketIDs) data.ticketIDs.forEach((id: number) => idSet.add(id));
      cUpd.setDate(cUpd.getDate() + 1);
      await new Promise(r => setTimeout(r, 150));
    }

    allIds = Array.from(idSet);
    console.log(`[${office}] Total IDs: ${allIds.length} (incremental, invoiceDate + dateUpdated ${dateFrom} → ${dateTo})`);
  }

  if (allIds.length === 0) {
    console.log(`[${office}] Nothing to sync`);
    return { created: created.count, updated: updated.count, errors: errors.count };
  }

  const tickets = await fetchInBatches('ticket/get', 'ticketIDs', allIds, key, token);
  for (const t of tickets) {
    await processTicket(t, office, created, updated, errors);
  }

  console.log(`[${office}] incremental complete: created=${created.count}, updated=${updated.count}, errors=${errors.count}`);
  return { created: created.count, updated: updated.count, errors: errors.count };
}

// ============================================================
// SYNC PAYMENTS
// ============================================================

async function syncPayments(
  office: string,
  key: string,
  token: string
): Promise<{ created: number; updated: number; errors: number }> {
  let created = 0, updated = 0, errors = 0;

  // Fetch only new payment IDs not yet in our DB
  const searchData = await frFetch('payment/search', '', key, token);
  if (!searchData.success) throw new Error('Payment search failed');

  const allIds: number[] = searchData.paymentIDs || [];

  const existing = await prisma.payment.findMany({
    where: { externalSource: 'fieldroutes', externalId: { not: null }, invoice: { office } },
    select: { externalId: true },
  });
  const syncedIds = new Set(existing.map((p: any) => p.externalId!));
  const newIds = allIds.filter(id => !syncedIds.has(String(id)));

  if (newIds.length === 0) return { created, updated, errors };

  const payments = await fetchInBatches('payment/get', 'paymentIDs', newIds, key, token);

  for (const p of payments) {
    try {
      if (!p.paymentApplications || p.paymentApplications.length === 0) continue;

      const totalApplied = parseFloat(p.appliedAmount || '0');

      for (const application of p.paymentApplications) {
        const ticketId = String(application.ticketID);
        const appliedAmount = parseFloat(application.appliedAmount);

        const invoice = await prisma.invoice.findFirst({ where: { externalId: ticketId } });
        if (!invoice) { errors++; continue; }

        if (totalApplied < 0 || appliedAmount < 0) {
          // Refund or void — remove the original payment record if it exists
          const originalPaymentId = p.originalPaymentID ? String(p.originalPaymentID) : null;
          if (originalPaymentId) {
            await prisma.payment.deleteMany({
              where: { externalId: originalPaymentId, invoiceId: invoice.id },
            });
          }
          // Record the refund as a negative payment
          await prisma.payment.create({
            data: {
              invoiceId: invoice.id,
              date: new Date(p.date),
              amount: appliedAmount, // negative
              method: p.cardType ? `${p.cardType}${p.lastFour ? ` ****${p.lastFour}` : ''}`.trim() : 'Refund',
              reference: p.transactionID || null,
              note: `Refund/Void - ${p.paymentSource || ''}`,
              externalId: String(p.paymentID),
              externalSource: 'fieldroutes',
            },
          });
        } else if (appliedAmount > 0) {
          // Normal payment
          await prisma.payment.create({
            data: {
              invoiceId: invoice.id,
              date: new Date(p.date),
              amount: appliedAmount,
              method: p.cardType ? `${p.cardType}${p.lastFour ? ` ****${p.lastFour}` : ''}`.trim() : 'FieldRoutes',
              reference: p.transactionID || null,
              note: p.paymentSource || null,
              externalId: String(p.paymentID),
              externalSource: 'fieldroutes',
            },
          });
        }
        created++;
      }
    } catch {
      errors++;
    }
  }

  return { created, updated, errors };
}

// ============================================================
// MAIN SYNC HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const officesToSync = body.office ? [body.office] : Object.keys(OFFICES);
  const fullSync: boolean = body.fullSync === true;
  const syncType: string = body.syncType || 'all';
  const fromDate: string | undefined = body.fromDate;
  const toDate: string | undefined = body.toDate;
  const specificIds: number[] | undefined = body.ticketIDs
    ? body.ticketIDs.split(',').map(Number)
    : undefined;

  const startedAt = new Date();
  const results: Record<string, any> = {};

  for (const office of officesToSync) {
    const config = OFFICES[office as keyof typeof OFFICES];
    if (!config) continue;

    const { key, token } = config;
    results[office] = { customers: null, invoices: null, payments: null, error: null };

    try {
      if (syncType === 'all' || syncType === 'customers') {
        // On fullSync, pass no fromDate so ALL customers are fetched (needed to backfill
        // commercial/multi-property exclusion flags across existing accounts, not just recently-updated).
        results[office].customers = await syncCustomers(office, key, token, fullSync ? undefined : fromDate);
      }
      if (syncType === 'all' || syncType === 'invoices') {
        results[office].invoices = await syncInvoices(office, key, token, fullSync, fromDate, specificIds, toDate);
      }
      if (syncType === 'all' || syncType === 'payments') {
        results[office].payments = await syncPayments(office, key, token);
      }

      // Self-heal any "Customer <id>" placeholders created this run (new customers whose
      // details weren't pulled yet). Enriches them from FR in batches so stubs never persist.
      try {
        results[office].healed = await healPlaceholderCustomers(office, key, token);
      } catch (e: any) {
        results[office].healed = { error: e.message };
      }

      await prisma.syncLog.create({
        data: {
          source: `fieldroutes_auto_${office}`,
          status: 'success',
          mode: 'auto_sync',
          customersCreated: results[office].customers?.created ?? 0,
          customersUpdated: results[office].customers?.updated ?? 0,
          invoicesCreated: results[office].invoices?.created ?? 0,
          invoicesUpdated: results[office].invoices?.updated ?? 0,
          paymentsCreated: results[office].payments?.created ?? 0,
          errorCount:
            (results[office].customers?.errors ?? 0) +
            (results[office].invoices?.errors ?? 0) +
            (results[office].payments?.errors ?? 0),
          startedAt,
          completedAt: new Date(),
        },
      });
    } catch (err: any) {
      results[office].error = err.message;
      await prisma.syncLog.create({
        data: {
          source: `fieldroutes_auto_${office}`,
          status: 'error',
          mode: 'auto_sync',
          errorCount: 1,
          errors: err.message,
          startedAt,
          completedAt: new Date(),
        },
      });
    }
  }

  return NextResponse.json({
    success: true,
    startedAt,
    completedAt: new Date(),
    results,
  });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const logs = await prisma.syncLog.findMany({
    where: { source: { startsWith: 'fieldroutes_auto' } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({ logs });
}
