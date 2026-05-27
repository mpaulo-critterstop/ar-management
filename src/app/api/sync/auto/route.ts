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

// These invoices have NO due date until closed out
const CLOSEOUT_SERVICE_IDS = new Set([
  553,  // Exclusion
  720,  // Trapping
  510,  // Fogging
  501,  // Full Attic Restoration
  624,  // Insulation Blow-In - Cellulose
  542,  // Insulation Blow-In - Fiberglass
  541,  // Insulation Removal
  479,  // Insulation Removal and Blow In
  674,  // Insulation Top Off
]);

// These are Wildlife but due on creation date
const WILDLIFE_SERVICE_IDS = new Set([
  // Available to all offices
  533, 538, 509, 1065, 1060, 719, 1064, 1061,
  615, 671, 546, 620, 554, 687, 688,
  677, 619, 682, 496, 1058, 544, 487,
  683, 631, 526, 1062, 636, 504,
  1059, 1063, 189, 287, 685, 690, 691, 684, 489,
  // ATX specific
  670, 485, 614, 502, 609, 520, 678, 517, 645, 686,
  // CStat specific
  746, 884,
  // OKC specific
  710, 705, 715, 716, 717, 722, 724, 725, 726, 727,
]);

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const SYNC_FROM_DATE = '2024-01-01';
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

function mapOfficeId(officeId: string): string {
  const map: Record<string, string> = {
    '1': 'DFW',
    '5': 'ATX',
    '3': 'OKC',
    '4': 'CStat',
  };
  return map[officeId] || 'DFW';
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

  // Get all active customer IDs
  const searchData = await frFetch('customer/search', 'status=1', key, token);
  if (!searchData.success) throw new Error('Customer search failed');

  const allIds: number[] = searchData.customerIDs || [];

  // Get already synced customer externalIds
  const existing = await prisma.customer.findMany({
    where: { office, externalId: { not: null } },
    select: { externalId: true, id: true },
  });
  const existingMap = new Map(existing.map(c => [c.externalId!, c.id]));

  // Fetch all customers in batches
  const customers = await fetchInBatches('customer/get', 'customerIDs', allIds, key, token);

  for (const c of customers) {
    try {
      // Skip inactive or cancelled
      if (c.status !== '1') continue;
      if (c.dateCancelled && c.dateCancelled !== '0000-00-00 00:00:00') continue;
      if (c.pendingCancel === '1') continue;

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
// SYNC INVOICES
// ============================================================

async function syncInvoices(
  office: string,
  key: string,
  token: string
): Promise<{ created: number; updated: number; errors: number }> {
  let created = 0, updated = 0, errors = 0;

  // Search tickets from sync date
  const searchData = await frFetch(
    'ticket/search',
    `dateStart=${SYNC_FROM_DATE}`,
    key,
    token
  );
  if (!searchData.success) throw new Error('Ticket search failed');

  const allIds: number[] = searchData.ticketIDs || [];

  // Get already synced invoice externalIds
  const existing = await prisma.invoice.findMany({
    where: { office, externalId: { not: null } },
    select: { externalId: true, id: true },
  });
  const existingMap = new Map(existing.map(i => [i.externalId!, i.id]));

  // Fetch tickets in batches
  const tickets = await fetchInBatches('ticket/get', 'ticketIDs', allIds, key, token);

  for (const t of tickets) {
    try {
      // Skip inactive or zero amount
      if (t.active !== '1') continue;
      if (parseFloat(t.total) === 0) continue;
      /const invoiceDate = t.invoiceDate || t.dateCreated;
      // Skip invoices before sync date
      if (invoiceDate < SYNC_FROM_DATE) continue;

      const serviceId = parseInt(t.serviceID);
      const serviceType = getServiceType(serviceId);
      const due = getDueDate(serviceId, invoiceDate);
      const amount = parseFloat(t.total);
      const balance = parseFloat(t.balance);
      const paid = Math.max(0, amount - balance);
      const status = getInvoiceStatus(balance, due);

      // Find the customer in our DB
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
          data: {
            id: String(t.ticketID),
            ...invoiceData,
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
// SYNC PAYMENTS
// ============================================================

async function syncPayments(
  office: string,
  key: string,
  token: string
): Promise<{ created: number; updated: number; errors: number }> {
  let created = 0, updated = 0, errors = 0;

  // Search payments
  const searchData = await frFetch('payment/search', '', key, token);
  if (!searchData.success) throw new Error('Payment search failed');

  const allIds: number[] = searchData.paymentIDs || [];

  // Get already synced payment externalIds
  const existing = await prisma.payment.findMany({
    where: { externalSource: 'fieldroutes', externalId: { not: null } },
    select: { externalId: true },
  });
  const syncedIds = new Set(existing.map(p => p.externalId!));

  // Filter to only new payments
  const newIds = allIds.filter(id => !syncedIds.has(String(id)));
  if (newIds.length === 0) return { created, updated, errors };

  // Fetch new payments in batches
  const payments = await fetchInBatches('payment/get', 'paymentIDs', newIds, key, token);

  for (const p of payments) {
    try {
      if (parseFloat(p.appliedAmount) <= 0) continue;
      if (!p.paymentApplications || p.paymentApplications.length === 0) continue;

      for (const application of p.paymentApplications) {
        const ticketId = String(application.ticketID);
        const appliedAmount = parseFloat(application.appliedAmount);
        if (appliedAmount <= 0) continue;

        // Find matching invoice
        const invoice = await prisma.invoice.findFirst({
          where: { externalId: ticketId, office },
        });

        if (!invoice) {
          errors++;
          continue;
        }

        // Update invoice paid amount and status
        const newPaid = Math.min(Number(invoice.amount), Number(invoice.paid) + appliedAmount);
        const isFullyPaid = newPaid >= Number(invoice.amount);

        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            paid: newPaid,
            status: isFullyPaid ? 'PAID' : invoice.status,
          },
        });

        // Create payment record
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
      // Step 1: Sync customers
      results[office].customers = await syncCustomers(office, key, token);

      // Step 2: Sync invoices
      results[office].invoices = await syncInvoices(office, key, token);

      // Step 3: Sync payments
      results[office].payments = await syncPayments(office, key, token);

      // Log success
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
