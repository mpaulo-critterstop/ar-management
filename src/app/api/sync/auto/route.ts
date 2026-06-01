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
// SYNC CUSTOMERS
// ============================================================

async function syncCustomers(
  office: string,
  key: string,
  token: string
): Promise<{ created: number; updated: number; errors: number }> {
  let created = 0, updated = 0, errors = 0;

  const searchData = await frFetch('customer/search', '', key, token);
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
     // Sync all customers regardless of status
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
  token: string,
  fullSync = false,
  fromDate?: string,
  specificIds?: number[]
): Promise<{ created: number; updated: number; errors: number }> {
  let created = 0, updated = 0, errors = 0;

  let allIds: number[] = [];

  // Using upsert — no need to load existing invoices map

  if (specificIds && specificIds.length > 0) {
    allIds = specificIds;
    console.log(`[${office}] Syncing ${allIds.length} specific ticket IDs`);
  } else if (fullSync) {
    const searchData = await frFetch('ticket/search', '', key, token);
    if (!searchData.success) throw new Error('Ticket search failed');
    allIds = searchData.ticketIDs || [];
    console.log(`[${office}] Total IDs: ${allIds.length} (fullSync=true)`);

    // Process in chunks of 5000 to avoid OOM on large offices like DFW
    const CHUNK_SIZE = 5000;
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
      const chunk = allIds.slice(i, i + CHUNK_SIZE);
      console.log(`[${office}] Processing chunk ${Math.floor(i/CHUNK_SIZE)+1}/${Math.ceil(allIds.length/CHUNK_SIZE)} (${chunk.length} IDs)`);
      const tickets = await fetchInBatches('ticket/get', 'ticketIDs', chunk, key, token);
      for (const t of tickets) {
        try {
          if (parseFloat(t.total) === 0) {
        // Voided invoice — mark as PAID in DB
        await prisma.invoice.updateMany({
          where: { externalId: String(t.ticketID), office },
          data: { status: 'PAID', paid: 0, amount: 0 },
        });
        continue;
      }
          if (t.active !== '1') {
            await prisma.invoice.updateMany({
              where: { externalId: String(t.ticketID), office },
              data: { status: 'PAID', paid: parseFloat(t.total) },
            });
            continue;
          }
          if (t.officeID !== OFFICES[office as keyof typeof OFFICES].officeId && t.officeID !== '-1') continue;
          const resolvedCustomerID = t.billToAccountID !== '0' && t.billToAccountID !== t.customerID ? t.billToAccountID : t.customerID;
          const invoiceDate = t.invoiceDate || t.dateCreated;
          const serviceId = parseInt(t.serviceID);
          const serviceType = getServiceType(serviceId);
          const due = getDueDate(serviceId, invoiceDate);
          const amount = parseFloat(t.total);
          const balance = parseFloat(t.balance);
          const paid = Math.max(0, amount - balance);
          const status = getInvoiceStatus(balance, due);
          const customer = await prisma.customer.findFirst({
            where: { externalId: String(resolvedCustomerID), office },
          });
          if (!customer) { errors++; continue; }
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
          await prisma.invoice.upsert({
            where: { id: String(t.ticketID) },
            update: invoiceData,
            create: { id: String(t.ticketID), ...invoiceData },
          });
          created++;
        } catch (err: any) {
          errors++;
        }
      }
    }
    console.log(`[${office}] fullSync complete: created=${created}, errors=${errors}`);
    return { created, updated, errors };
  } else {
    // Incremental sync — use dateUpdated for daily syncs (fast and efficient)
    const lastSync = await prisma.syncLog.findFirst({
      where: { source: `fieldroutes_auto_${office}`, status: 'success' },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });
    const dateFrom = fromDate || (lastSync?.completedAt
      ? lastSync.completedAt.toISOString().split('T')[0]
      : '2020-01-01');
    const dateTo = new Date().toISOString().split('T')[0];
    console.log(`[${office}] Incremental sync from: ${dateFrom} to: ${dateTo}`);

    if (fromDate) {
      // Day-by-day invoiceDate loop — process each day immediately to save memory
      let current = new Date(dateFrom);
      const end = new Date(dateTo);
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        const searchData = await frFetch('ticket/search', `invoiceDate=${dateStr}`, key, token);
        if (searchData.success && searchData.ticketIDs && searchData.ticketIDs.length > 0) {
          const dayIds = searchData.ticketIDs as number[];
          const dayTickets = await fetchInBatches('ticket/get', 'ticketIDs', dayIds, key, token);
          for (const t of dayTickets) {
            try {
              if (parseFloat(t.total) === 0) {
        // Voided invoice — mark as PAID in DB
        await prisma.invoice.updateMany({
          where: { externalId: String(t.ticketID), office },
          data: { status: 'PAID', paid: 0, amount: 0 },
        });
        continue;
      }
      if (t.active !== '1') {
        // Mark deleted/inactive invoices as PAID in our DB
        await prisma.invoice.updateMany({
          where: { externalId: String(t.ticketID), office },
          data: { status: 'PAID', paid: parseFloat(t.total) },
        });
        continue;
      }
              if (t.officeID !== OFFICES[office as keyof typeof OFFICES].officeId) continue;
              const resolvedCustomerID = t.billToAccountID !== '0' && t.billToAccountID !== t.customerID
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
              const customer = await prisma.customer.findFirst({
                where: { externalId: String(resolvedCustomerID), office },
              });
              if (!customer) { errors++; continue; }
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
              const upsertResult = await prisma.invoice.upsert({
        where: { id: String(t.ticketID) },
        update: invoiceData,
        create: { id: String(t.ticketID), ...invoiceData },
      });
      if (upsertResult.createdAt.getTime() === upsertResult.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }
            } catch (err: any) {
              errors++;
            }
          }
        }
        current.setDate(current.getDate() + 1);
        await new Promise(r => setTimeout(r, 150));
      }
      console.log(`[${office}] invoiceDate loop complete: created=${created}, updated=${updated}, errors=${errors}`);
      return { created, updated, errors };
    } 
    else {
      // Regular incremental — dateUpdated filter
      const searchData = await frFetch('ticket/search', `dateUpdated=${dateFrom}`, key, token);
      if (!searchData.success) throw new Error('Ticket search failed');
      allIds = searchData.ticketIDs || [];
      console.log(`[${office}] Total IDs: ${allIds.length} (incremental, dateUpdated>=${dateFrom})`);
    }
  }
 

  if (allIds.length === 0) {
    console.log(`[${office}] Nothing to sync`);
    return { created, updated, errors };
  }

  const tickets = await fetchInBatches('ticket/get', 'ticketIDs', allIds, key, token);

  for (const t of tickets) {
    try {
      // Skip if total is zero — nothing to invoice
      if (parseFloat(t.total) === 0) continue;
      if (t.active !== '1') {
        // Mark deleted/inactive invoices as PAID in our DB
        await prisma.invoice.updateMany({
          where: { externalId: String(t.ticketID), office },
          data: { status: 'PAID', paid: parseFloat(t.total) },
        });
        continue;
      }
      // Use billToAccountID as the customer if different (billing account setup)
      const resolvedCustomerID = t.billToAccountID !== '0' && t.billToAccountID !== t.customerID
        ? t.billToAccountID
        : t.customerID;
      if (t.officeID !== OFFICES[office as keyof typeof OFFICES].officeId) continue;

      const invoiceDate = t.invoiceDate || t.dateCreated;
      const serviceId = parseInt(t.serviceID);
      const serviceType = getServiceType(serviceId);
      const due = getDueDate(serviceId, invoiceDate);
      const amount = parseFloat(t.total);
      const balance = parseFloat(t.balance);
      const paid = Math.max(0, amount - balance);
      const status = getInvoiceStatus(balance, due);

      const customer = await prisma.customer.findFirst({
        where: { externalId: String(resolvedCustomerID), office },
      });

      if (!customer) {
        console.log(`[${office}] Customer not found: resolvedID=${resolvedCustomerID}, customerID=${t.customerID}, billToAccountID=${t.billToAccountID}, ticketID=${t.ticketID}`);
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
        serviceId,
        office,
        externalId: String(t.ticketID),
        externalSource: 'fieldroutes',
      };

     await prisma.invoice.upsert({
        where: { id: String(t.ticketID) },
        update: invoiceData,
        create: { id: String(t.ticketID), ...invoiceData },
      });
      created++;
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
  const syncedIds = new Set(existing.map((p: any) => p.externalId!));

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
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

 const body = await req.json().catch(() => ({}));
  const officesToSync = body.office
    ? [body.office]
    : Object.keys(OFFICES);
  const fullSync: boolean = body.fullSync === true;
  const syncType: string = body.syncType || 'all';
  const fromDate: string | undefined = body.fromDate;
  const specificIds: number[] | undefined = body.ticketIDs ? body.ticketIDs.split(',').map(Number) : undefined;

  const startedAt = new Date();
  const results: Record<string, any> = {};

  for (const office of officesToSync) {
    const config = OFFICES[office as keyof typeof OFFICES];
    if (!config) continue;

    const { key, token } = config;
    results[office] = { customers: null, invoices: null, payments: null, error: null };

    try {
      if (syncType === 'all' || syncType === 'customers') {
        results[office].customers = await syncCustomers(office, key, token);
      }
      if (syncType === 'all' || syncType === 'invoices') {
        results[office].invoices = await syncInvoices(office, key, token, fullSync, fromDate, specificIds);
      }
      if (syncType === 'all' || syncType === 'payments') {
        results[office].payments = await syncPayments(office, key, token);
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
