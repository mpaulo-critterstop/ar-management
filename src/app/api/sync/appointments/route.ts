// src/app/api/sync/appointments/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const OFFICES = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW!, officeId: '1' },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX!, officeId: '5' },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC!, officeId: '3' },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: '4' },
};

const WILDLIFE_INSPECTION_IDS = new Set(['645', '1037', '884', '722', '544', '719', '619']);
const SOLD_SERVICE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];
const TRAPPING_IDS = new Set(['720']);
const FAR_IDS = new Set(['501', '674', '479', '541', '542', '624']);

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 1000;

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchInBatches(endpoint: string, idParam: string, ids: number[], key: string, token: string): Promise<any[]> {
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

async function syncLeads(office: string, key: string, token: string) {
  let created = 0, updated = 0, errors = 0;

  // ============================================================
  // STEP 1: SOLD LEADS — driven by sold invoices from 2026
  // ============================================================
  console.log(`[${office}] Step 1: Fetching sold invoices from 2026...`);

  // Get all sold invoices from our DB with invoiceDate >= 2026-01-01
  const soldInvoices = await prisma.invoice.findMany({
    where: {
      office,
      serviceId: { in: SOLD_SERVICE_IDS },
      amount: { gt: 0 },
      status: { not: 'PAID' as any },
      date: { gte: new Date('2026-01-01') },
    },
    include: {
      customer: { select: { id: true, externalId: true, name: true } },
    },
    orderBy: { date: 'asc' },
  });

  // Also get PAID sold invoices from 2026 (fully collected jobs)
  const paidSoldInvoices = await prisma.invoice.findMany({
    where: {
      office,
      serviceId: { in: SOLD_SERVICE_IDS },
      amount: { gt: 0 },
      status: 'PAID' as any,
      date: { gte: new Date('2026-01-01') },
    },
    include: {
      customer: { select: { id: true, externalId: true, name: true } },
    },
    orderBy: { date: 'asc' },
  });

  const allSoldInvoices = [...soldInvoices, ...paidSoldInvoices];
  console.log(`[${office}] Sold invoices found: ${allSoldInvoices.length}`);

  // Fetch all 2026+ appointments to get inspection dates and PM names
  console.log(`[${office}] Fetching 2026+ appointments for PM/date lookup...`);
  const apptSearch = await frFetch('appointment/search', 'dateStart=2025-01-01', key, token);
  const allApptIds: number[] = apptSearch.appointmentIDs || [];
  const appointments = await fetchInBatches('appointment/get', 'appointmentIDs', allApptIds, key, token);

  // Filter to completed wildlife inspections
  const inspections = appointments.filter((a: any) =>
    WILDLIFE_INSPECTION_IDS.has(String(a.type)) && a.status === '1'
  );
  console.log(`[${office}] Wildlife inspections found: ${inspections.length}`);

 // Build customer → inspections map (all inspections per customer)
  const customerInspectionsMap = new Map<string, any[]>();
  for (const a of inspections) {
    const existing = customerInspectionsMap.get(String(a.customerID)) || [];
    existing.push(a);
    customerInspectionsMap.set(String(a.customerID), existing);
  }

  // Fetch employee names
  const employeeIds = [...new Set(inspections.map((a: any) => a.servicedBy || a.completedBy).filter(Boolean))];
  const employeeMap = new Map<string, string>();
  if (employeeIds.length > 0) {
    const empData = await frFetch('employee/get', `employeeIDs=${employeeIds.join(',')}`, key, token);
    if (empData.success && empData.employees) {
      for (const e of empData.employees) {
        employeeMap.set(String(e.employeeID), `${e.fname} ${e.lname}`.trim());
      }
    }
  }

  // Create/update SOLD leads for each sold invoice
  for (const invoice of allSoldInvoices) {
    try {
      if (!invoice.customer) { errors++; continue; }

      // Find the inspection appointment for this customer
      const inspection = invoice.customer.externalId ? customerInspectionMap.get(invoice.customer.externalId) : null;
      const pmName = inspection ? employeeMap.get(String(inspection.servicedBy || inspection.completedBy)) || null : null;
      const inspectionDate = inspection?.date ? new Date(inspection.date) : null;

      // Check if lead already exists for this invoice
      const existingLead = await prisma.lead.findFirst({
        where: { invoiceId: invoice.id },
      });

      const leadData = {
        office,
        customerId: invoice.customer.id,
        pmName,
        inspectionDate,
        status: 'SOLD' as const,
        invoiceId: invoice.id,
        amount: Number(invoice.amount),
      };

      if (existingLead) {
        await prisma.lead.update({
          where: { id: existingLead.id },
          data: {
            pmName: leadData.pmName || existingLead.pmName,
            inspectionDate: existingLead.inspectionDate || leadData.inspectionDate,
          },
        });
        updated++;
      } else {
        // Only create if no CSV lead exists for this customer
        const csvLead = await prisma.lead.findFirst({
          where: { customerId: invoice.customer.id, office, externalId: { startsWith: 'csv_' } },
        });
        if (csvLead) {
          // Update the CSV lead instead
          await prisma.lead.update({
            where: { id: csvLead.id },
            data: {
              pmName: leadData.pmName || csvLead.pmName,
              inspectionDate: csvLead.inspectionDate || leadData.inspectionDate,
            },
          });
          updated++;
        } else {
          await prisma.lead.create({
            data: { externalId: `inv_${invoice.id}`, ...leadData },
          });
          created++;
          await createDispatchJob(invoice.customer.id, invoice.id, office, pmName, invoice.customer.externalId || '', key, token);
        }
      }
    } catch (err: any) {
      errors++;
      console.error(`[${office}] Error creating SOLD lead for invoice ${invoice.id}:`, err.message);
    }
  }

  console.log(`[${office}] Step 1 complete: ${created} created, ${updated} updated, ${errors} errors`);

  // ============================================================
  // STEP 2: INSPECTED LEADS — appointments with no sold invoice
  // ============================================================
  console.log(`[${office}] Step 2: Creating INSPECTED leads...`);
  let inspCreated = 0, inspUpdated = 0;

  // Get all customers who already have a SOLD lead
  const soldCustomerIds = new Set(
    (await prisma.lead.findMany({
      where: { office, status: 'SOLD' },
      select: { customerId: true },
    })).map((l: any) => l.customerId)
  );

  for (const a of inspections) {
    try {
      // Only process 2026 appointments
      if (!a.date || new Date(a.date) < new Date('2026-01-01')) continue;

      const customer = await prisma.customer.findFirst({
        where: { externalId: String(a.customerID), office },
      });
      if (!customer) continue;

      // Skip if customer already has a SOLD lead
      if (soldCustomerIds.has(customer.id)) continue;

      const pmName = employeeMap.get(String(a.servicedBy || a.completedBy)) || null;

      // Check if INSPECTED lead already exists for this appointment
      const existingLead = await prisma.lead.findUnique({
        where: { externalId: String(a.appointmentID) },
      });

      const leadData = {
        office,
        customerId: customer.id,
        pmName,
        inspectionDate: new Date(a.date),
        status: 'INSPECTED' as const,
        invoiceId: null,
        amount: null,
      };

      if (existingLead) {
        await prisma.lead.update({
          where: { externalId: String(a.appointmentID) },
          data: leadData,
        });
        inspUpdated++;
      } else {
        // Check for duplicate by customer + date
        const dayStart = new Date(a.date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(a.date);
        dayEnd.setHours(23, 59, 59, 999);
        const existingByDate = await prisma.lead.findFirst({
          where: { customerId: customer.id, office, inspectionDate: { gte: dayStart, lte: dayEnd } },
        });
        if (existingByDate) { inspUpdated++; continue; }

        await prisma.lead.create({
          data: { externalId: String(a.appointmentID), ...leadData },
        });
        inspCreated++;
      }
    } catch (err) {
      errors++;
    }
  }

  console.log(`[${office}] Step 2 complete: ${inspCreated} created, ${inspUpdated} updated`);
  created += inspCreated;
  updated += inspUpdated;

  return { created, updated, errors };
}

async function createDispatchJob(customerId: string, invoiceId: string, office: string, pmName: string | null, customerFRId: string, key: string, token: string) {
  const existing = await prisma.dispatchJob.findFirst({ where: { customerId, invoiceId } });
  if (existing) return;

  const customerData = await frFetch('customer/get', `customerIDs=${customerFRId}`, key, token);
  const ticketIDs = customerData.customers?.[0]?.ticketIDs?.split(',') || [];
  let hasTrapping = false;
  let hasFAR = false;

  if (ticketIDs.length > 0) {
    const tickets = await frFetch('ticket/get', `ticketIDs=${ticketIDs.slice(0, 10).join(',')}`, key, token);
    if (tickets.success && tickets.tickets) {
      for (const t of tickets.tickets) {
        if (TRAPPING_IDS.has(String(t.serviceID))) hasTrapping = true;
        if (FAR_IDS.has(String(t.serviceID))) hasFAR = true;
      }
    }
  }

  await prisma.dispatchJob.create({
    data: { office, customerId, invoiceId, pmName, hasTrapping, hasFAR, status: 'ACTIVE' },
  });
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const officesToSync = body.office ? [body.office] : Object.keys(OFFICES);
  const results: Record<string, any> = {};

  for (const office of officesToSync) {
    const config = OFFICES[office as keyof typeof OFFICES];
    if (!config) continue;
    try {
      results[office] = await syncLeads(office, config.key, config.token);
    } catch (err: any) {
      results[office] = { error: err.message };
    }
  }

  return NextResponse.json({ success: true, results });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ message: 'Leads sync endpoint ready' });
}
