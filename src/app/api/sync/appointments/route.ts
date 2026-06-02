// src/app/api/sync/appointments/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

const WILDLIFE_INSPECTION_IDS = new Set(['645', '1037', '884', '722', '544', '719', '619']);
const TRAPPING_IDS = new Set(['720']);
const FAR_IDS = new Set(['501', '674', '479', '541', '542', '624']);

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 1000;

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

async function syncAppointments(office: string, key: string, token: string, fromDate?: string) {
  let created = 0, updated = 0, errors = 0;

  // Fetch 2026+ appointment IDs only
  console.log(`[${office}] Fetching 2026+ appointment IDs`);
  const searchData = await frFetch('appointment/search', 'dateStart=2026-01-01', key, token);
  if (!searchData.success) throw new Error('Appointment search failed');
  const allIds: number[] = searchData.appointmentIDs || [];
  console.log(`[${office}] Total appointment IDs: ${allIds.length}`);
  if (allIds.length === 0) return { created, updated, errors };

  const appointments = await fetchInBatches('appointment/get', 'appointmentIDs', allIds, key, token);

  // Filter to wildlife inspection appointments only, completed status, 2026 onwards
  const inspections = appointments.filter((a: any) =>
    WILDLIFE_INSPECTION_IDS.has(String(a.type)) &&
    a.status === '1' &&
    a.date && new Date(a.date) >= new Date('2026-01-01')
  );
  console.log(`[${office}] Wildlife inspections found: ${inspections.length}`);

  // Get all employee IDs to fetch names
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

  for (const a of inspections) {
    try {
      const customer = await prisma.customer.findFirst({
        where: { externalId: String(a.customerID), office },
      });
      if (!customer) { errors++; continue; }

      // Use ticketID directly from appointment to find invoice
      // Skip the $0 inspection invoice — look for real exclusion invoice
      let invoice = null;

      // Find the sold invoice closest to this inspection date
      const inspectionDate = a.date ? new Date(a.date) : new Date();
      invoice = await prisma.invoice.findFirst({
        where: {
          customerId: customer.id,
          office,
          serviceId: { in: [553, 716, 720, 501, 674, 479, 541, 542, 624, 510] },
          amount: { gt: 0 },
          date: { gte: inspectionDate },
        },
        orderBy: { date: 'asc' },
      });
      const status = invoice && Number(invoice.amount) > 0 ? 'SOLD' : 'INSPECTED';

      const pmName = employeeMap.get(String(a.servicedBy || a.completedBy)) || null;

      const existingLead = await prisma.lead.findUnique({
        where: { externalId: String(a.appointmentID) },
      });

      // Skip if customer already has a SOLD lead from CSV import
      if (!existingLead && status === 'INSPECTED') {
        const soldLead = await prisma.lead.findFirst({
          where: { customerId: customer.id, office, status: 'SOLD' },
        });
        if (soldLead) { updated++; continue; }
      }

      const leadData = {
        office,
        customerId: customer.id,
        pmName,
        inspectionDate: a.date ? new Date(a.date) : null,
        status,
        invoiceId: invoice?.id || null,
        amount: invoice ? Number(invoice.amount) : null,
      };

      if (existingLead) {
        await prisma.lead.update({
          where: { externalId: String(a.appointmentID) },
          data: leadData,
        });
        updated++;
      } else {
        await prisma.lead.create({
          data: { externalId: String(a.appointmentID), ...leadData },
        });
        created++;

        // If sold, create dispatch job
        if (status === 'SOLD' && invoice) {
          await createDispatchJob(customer.id, invoice.id, office, pmName, String(a.customerID), key, token);
        }
      }
    } catch (err) {
      errors++;
    }
  }

  return { created, updated, errors };
}

async function createDispatchJob(
  customerId: string,
  invoiceId: string,
  office: string,
  pmName: string | null,
  customerFRId: string,
  key: string,
  token: string
) {
  // Check if dispatch job already exists
  const existing = await prisma.dispatchJob.findFirst({
    where: { customerId, invoiceId },
  });
  if (existing) return;

  // Check invoice service type to determine trapping/FAR
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
    data: {
      office,
      customerId,
      invoiceId,
      pmName,
      hasTrapping,
      hasFAR,
      status: 'ACTIVE',
    },
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
  const fromDate: string | undefined = body.fromDate;

  const results: Record<string, any> = {};

  for (const office of officesToSync) {
    const config = OFFICES[office as keyof typeof OFFICES];
    if (!config) continue;
    try {
      results[office] = await syncAppointments(office, config.key, config.token, fromDate);
    } catch (err: any) {
      results[office] = { error: err.message };
    }
  }

  return NextResponse.json({ success: true, results });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ message: 'Appointment sync endpoint ready' });
}
