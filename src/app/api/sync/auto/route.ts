// src/app/api/sync/auto/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
  553, 720, 510, 501, 624, 542, 541, 479, 674,
]);

const WILDLIFE_SERVICE_IDS = new Set([
  533, 538, 509, 1065, 1060, 719, 1064, 1061,
  615, 671, 546, 620, 554, 687, 688,
  677, 619, 682, 496, 1058, 544, 487,
  683, 631, 526, 1062, 636, 504,
  1059, 1063, 189, 287, 685, 690, 691, 684, 489,
  670, 485, 614, 502, 609, 520, 678, 517, 645, 686,
  746, 884,
  710, 705, 715, 716, 717, 722, 724, 725, 726, 727,
]);

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 100;

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
// SYNC CUSTOMERS
// ============================================================

async function syncCustomers(
  office: string,
  key: string,
  token: string
): Promise<{ created: number; updated: number; errors: number }> {
  let created = 0, updated = 0, errors = 0;

  const searchData = await frFetch('customer/search', 'status=1', key, token);
  if (!searchData.success) throw new Error('Customer search failed');

  const allIds: number[] = searchData.customerIDs || [];

  const existing = await prisma.customer.findMany({
    where: { office, externalId: { not: null } },
    select: { externalId: true, id: true },
  });
  const existingMap = new Map(existing.map(c => [c.externalId!, c.id]));

  const customers = await fetchInBatches('customer/get', 'customerIDs', allIds, key, token);

  for (const c of customers) {
    try {
      if (c.status !== '1' && parseFloat(c.responsibleBalance) <= 0) continue;
      if (c.pendingCancel === '1') continue;
      if (c.officeID !== OFFICES[office as keyof typeof OFFICES].officeId) continue;

      const name = c.companyName?.trim()
        ? c.companyName.trim()
        : `${c.fname || ''} ${c.lname || ''}`.trim();

      const serviceAddr = [c.address, c.city, c.state, c.zip]
        .filter(Boolean)
        .join(', ');

      const customerData = {
        name,
        email: c.email || null,
        phone: c.phone1 || null,
        serviceAddr: serviceAddr || null,
        office,
        externalId: String(c.customerID),
        externalSource: 'fieldroutes',
        status: 'ACTIVE' as const,
      };

      const existingId = existingMap.get(String(c.customerID));

      if (existingId) {
        await prisma.customer.update({
          where: { id: existingId },
          data: customerData,
        });
        updated++;
      } else {
        await prisma.customer.create({ data: customerData });
        created++;
      }
    } catch (err: any) {
      errors++;
    }
  }

  return { created, updated, errors };
}

// ============================================================
// SYNC INVOICES (INCREMENTAL)
// ============================================================

async function syncInvoices(
  office: string,
  key: string,
  token: string
): Promise<{ created: number; updated: number; errors: number }> {
  let created = 0, updated = 0, errors = 0;

  // Fetch ALL ticket IDs from FieldRoutes (filters are ignored by API)
  const searchData = await frFetch('ticket/search', `officeID=${OFFICES[office as keyof typeof OFFICES].officeId}`, key, token);
  if (!searchData.success) throw new Error('Ticket search failed');

  const allIds: number[] = searchData.ticketIDs || [];

  // Load existing invoices for this office
  const existing = await prisma.invoice.findMany({
    where: { office, externalId: { not: null } },
    select: { externalId: true, id: true, status: true },
  });
  const existingMap = new Map(existing.map(i => [i.externalId!, i.id]));

  // Find the highest ticket ID we already have synced
  const maxExistingId = existing.length > 0
    ? Math.max(...existing.map(i => parseInt(i.externalId!)).filter(n => !isNaN(n)))
    : 0;

  // Get all unpaid invoice external IDs (need balance updates)
  const unpaidInvoices = await prisma.invoice.findMany({
    where: { office, status: { not: 'PAID' }, externalId: { not: null } },
    select: { externalId: true },
  });
  const unpaidSet = new Set(unpaidInvoices.map(i => parseInt(i.externalId!)));

  // Incremental filter: only fetch new tickets + existing unpaid ones
  const idsToFetch = allIds.filter(id => id > maxExistingId || unpaidSet.has(id));

  console.log(`[${office}] Total IDs: ${allIds.length}, Fetching: ${idsToFetch.length} (${idsToFetch.length - unpaidSet.size} new + ${unpaidSet.size} unpaid updates)`);

  if (idsToFetch.length === 0) {
    console.log(`[${office}] Nothing to sync`);
    return { created, updated, errors };
  }

  const tickets = await fetchInBatches('ticket/get', 'ticketIDs', idsToFetch, key, token);

  for (const t of tickets) {
    try {
      // Skip if total is zero — nothing to invoice
      if (parseFloat(t.total) === 0) continue;
      // Skip if inactive AND no remaining balance — already resolved
      if (t.active !== '1' && parseFloat(t.balance) === 0) continue;
      // Skip if billed to a different account (sub-account billing)
      if (t.billToAccountID !== t.customerID) continue;

      const invoiceDate = t.invoiceDate || t.dateCreated;
      const serviceId = parseInt(t.serviceID);
      const serviceType = getServiceType(serviceId);
      const due = getDueDate(serviceId, invoiceDate);
      const amount = parseFloat(t.total);
      const balance = parseFloat(t.balance);
      const paid = Math.max(0, amount - balance);
      const status = getInvoiceStatus(balance, due);

      const customer = await prisma.customer.findFirst({
        where: { externalId: String(t.customerID), office },
      });

      if (!customer) {
        errors++;
        continue;
      }

      const invoiceData = {
        customerId: customer.id,
        date: new Date(invoiceDate),
        due,
        amount,
        paid,
        status: status as any,
        serviceType,
        office,
        externalId: String(t.ticketID),
        externalSource: 'fieldroutes',
      };

      const existingId = existingMap.get(String(t.ticketID));

      if (existingId) {
        await prisma.invoice.update({
          where: { id: existingId },
          data: invoiceData,
        });
        updated++;
      } else {
        await prisma.invoice.create({
          data: { id: String(t.ticketID), ...invoiceData },
        });
        created++;
      }
    } catch (err: any) {
      errors++;
    }
  }

  return { created, updated, errors };
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

  const searchData = await frFetch('payment/search', '', key, token);
  if (!searchData.success) throw new Error('Payment search failed');

  const allIds: number[] = searchData.paymentIDs || [];

  const existing = await prisma.payment.findMany({
    where: {
      externalSource: 'fieldroutes',
      externalId: { not: null },
      invoice: { office },
    },
    select: { externalId: true },
  });
  const syncedIds = new Set(existing.map(p => p.externalId!));

  const newIds = allIds.filter(id => !syncedIds.has(String(id)));
  if (newIds.length === 0) return { created, updated, errors };

  const payments = await fetchInBatches('payment/get', 'paymentIDs', newIds, key, token);

  for (const p of payments) {
    try {
      if (parseFloat(p.appliedAmount) <= 0) continue;
      if (!p.paymentApplications || p.paymentApplications.length === 0) continue;

      for (const application of p.paymentApplications) {
        const ticketId = String(application.ticketID);
        const appliedAmount = parseFloat(application.appliedAmount);
        if (appliedAmount <= 0) continue;

        const invoice = await prisma.invoice.findFirst({
          where: { externalId: ticketId, office },
        });

        if (!invoice) {
          errors++;
          continue;
        }

        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            date: new Date(p.date),
            amount: appliedAmount,
            method: p.cardType
              ? `${p.cardType}${p.lastFour ? ` ****${p.lastFour}` : ''}`.trim()
              : 'FieldRoutes',
            reference: p.transactionID || null,
            note: p.paymentSource || null,
            externalId: String(p.paymentID),
            externalSource: 'fieldroutes',
          },
        });

        created++;
      }
    } catch (err: any) {
      errors++;
    }
  }

  return { created, updated, errors };
}

// ============================================================
// MAIN SYNC HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const officesToSync = body.office
    ? [body.office]
    : Object.keys(OFFICES);

  const startedAt = new Date();
  const results: Record<string, any> = {};

  for (const office of officesToSync) {
    const config = OFFICES[office as keyof typeof OFFICES];
    if (!config) continue;

    const { key, token } = config;
    results[office] = { customers: null, invoices: null, payments: null, error: null };

    try {
      results[office].customers = await syncCustomers(office, key, token);
      results[office].invoices = await syncInvoices(office, key, token);
      results[office].payments = await syncPayments(office, key, token);

      await prisma.syncLog.create({
        data: {
          source: `fieldroutes_auto_${office}`,
          status: 'success',
          mode: 'auto_sync',
          customersCreated: results[office].customers.created,
          customersUpdated: results[office].customers.updated,
          invoicesCreated: results[office].invoices.created,
          invoicesUpdated: results[office].invoices.updated,
          paymentsCreated: results[office].payments.created,
          errorCount:
            results[office].customers.errors +
            results[office].invoices.errors +
            results[office].payments.errors,
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
