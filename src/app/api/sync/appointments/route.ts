// src/app/api/sync/appointments/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { healPlaceholderCustomers } from '@/lib/healPlaceholderCustomers';

const OFFICES = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW!, officeId: '1' },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX!, officeId: '5' },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC!, officeId: '3' },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: '4' },
};

const WILDLIFE_INSPECTION_IDS = new Set(['645', '1037', '884', '722', '544', '619']);
const SOLD_SERVICE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];
const TRAPPING_IDS = new Set(['720']);
const FAR_IDS = new Set(['501', '674', '479', '541', '542', '624']);

// CSV cutoff date — appointments after this date will be created by sync
const CSV_CUTOFF: Record<string, Date> = {
  DFW: new Date('2026-05-28'),
  ATX: new Date('2025-12-31'),
  OKC: new Date('2025-12-31'),
  CStat: new Date('2025-12-31'),
};

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
  // PART 1: Update existing leads ONLY when invoice is voided ($0 amount)
  // NEVER unlink invoices that are PAID — paid = job complete, still SOLD
  // ============================================================
  console.log(`[${office}] Part 1: Checking for voided invoices...`);

  const leads = await prisma.lead.findMany({
    where: { office, invoiceId: { not: null }, status: 'SOLD' },
    select: { id: true, invoiceId: true, status: true, amount: true },
  });

  for (const lead of leads) {
    try {
      if (!lead.invoiceId) continue;

      const invoice = await prisma.invoice.findUnique({
        where: { id: lead.invoiceId },
        select: { amount: true, serviceId: true },
      });

      if (!invoice) continue;

      const invoiceAmount = Number(invoice.amount);

      // Only consider voided if amount is literally $0
      // PAID invoices are NOT voided — they're collected!
      if (invoiceAmount === 0) {
        // Invoice was voided — revert lead to INSPECTED
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: 'INSPECTED',
            amount: null,
            invoiceId: null,
          },
        });
        updated++;
        console.log(`[${office}] Voided invoice detected, lead reverted to INSPECTED`);
      } else if (invoiceAmount !== lead.amount) {
        // Amount changed — update amount only, keep SOLD status
        await prisma.lead.update({
          where: { id: lead.id },
          data: { amount: invoiceAmount },
        });
        updated++;
      }
    } catch (err) {
      errors++;
    }
  }

  console.log(`[${office}] Part 1 complete: ${updated} updated`);
  // Part 1b: Check INSPECTED leads for new sold invoices
  console.log(`[${office}] Part 1b: Checking INSPECTED leads for sold invoices...`);
  const inspectedLeads = await prisma.lead.findMany({
    where: { office, status: 'INSPECTED', invoiceId: null },
    include: { customer: { select: { name: true, phone: true, email: true, externalId: true } } },
  });

  for (const lead of inspectedLeads) {
    try {
      const invoice = await prisma.invoice.findFirst({
        where: {
          customerId: lead.customerId,
          office,
          serviceId: { in: SOLD_SERVICE_IDS },
          amount: { gt: 0 },
          ...(lead.inspectionDate && { date: { gte: new Date(lead.inspectionDate.toISOString().split('T')[0]) } }),
        },
        orderBy: { date: 'asc' },
      });

      if (invoice) {
        const existingLink = await prisma.lead.findFirst({
          where: { invoiceId: invoice.id, NOT: { id: lead.id } },
        });
        if (!existingLink) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { status: 'SOLD', invoiceId: invoice.id, amount: Number(invoice.amount) },
          });
          // Notify PestAI if this lead was already sent to the follow-up pipeline
          if (lead.followUpSent) {
            const nameParts = (lead.customer?.name || '').trim().split(' ');
            fetch('https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/aGvw0JWUsOsikqvVKBmn', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fname:       nameParts[0] || '',
                lname:       nameParts.slice(1).join(' ') || '',
                phone1:      (lead.customer?.phone || '').replace(/\D/g, ''),
                email:       lead.customer?.email || '',
                customerID:  lead.id,
                salesRep:    lead.pmName || '',
                officeName:  lead.office || '',
                status:      'WON',
              }),
            }).catch(() => {}); // fire and forget
          }
          updated++;

          // Create the dispatch job for this newly-SOLD lead. Part 2 only creates jobs for leads
          // created fresh-as-SOLD; a lead that was already INSPECTED and flips to SOLD here (invoice
          // arrived later) was previously never getting a dispatch job. createDispatchJob is guarded
          // against duplicates (findFirst on customerId+invoiceId), so this is safe.
          try {
            await createDispatchJob(lead.customerId, invoice.id, office, lead.pmName, lead.customer?.externalId || String(lead.customerId), key, token);
          } catch (e) {
            // non-fatal: next sync retries
          }
        }
      }
    } catch (err) {
      errors++;
    }
  }
  console.log(`[${office}] Part 1b complete: ${updated} total updated`);

  // ============================================================
  // PART 2: Create new leads for appointments after CSV cutoff
  // ============================================================
  const cutoff = CSV_CUTOFF[office] || new Date('2025-12-31');
  console.log(`[${office}] Part 2: Creating new leads after ${cutoff.toISOString().split('T')[0]}...`);

  const apptSearch = await frFetch('appointment/search', 'dateStart=2026-01-01', key, token);
  const allApptIds: number[] = apptSearch.appointmentIDs || [];
  const appointments = await fetchInBatches('appointment/get', 'appointmentIDs', allApptIds, key, token);

  const newInspections = appointments.filter((a: any) =>
    WILDLIFE_INSPECTION_IDS.has(String(a.type)) &&
    a.status === '1' &&
    a.date && new Date(a.date) > cutoff
  );
  console.log(`[${office}] New inspections after cutoff: ${newInspections.length}`);

  const employeeIds = [...new Set(newInspections.map((a: any) => a.servicedBy || a.completedBy).filter(Boolean))];
  const employeeMap = new Map<string, string>();
  if (employeeIds.length > 0) {
    const empData = await frFetch('employee/get', `employeeIDs=${employeeIds.join(',')}`, key, token);
    if (empData.success && empData.employees) {
      for (const e of empData.employees) {
        employeeMap.set(String(e.employeeID), `${e.fname} ${e.lname}`.trim());
      }
    }
  }

  for (const a of newInspections) {
    try {
      const customer = await prisma.customer.findFirst({
        where: { externalId: String(a.customerID), office },
      });
      if (!customer) { errors++; continue; }

      const pmName = employeeMap.get(String(a.servicedBy || a.completedBy)) || null;
      const inspectionDate = new Date(a.date);

      const invoice = await prisma.invoice.findFirst({
        where: {
          customerId: customer.id,
          office,
          serviceId: { in: SOLD_SERVICE_IDS },
          amount: { gt: 0 },
          date: { gte: inspectionDate },
        },
        orderBy: { date: 'asc' },
      });

      const status = invoice ? 'SOLD' : 'INSPECTED';

      // Check duplicates
      const existingByAppt = await prisma.lead.findUnique({
        where: { externalId: String(a.appointmentID) },
      });
      if (existingByAppt) { updated++; continue; }

      if (invoice) {
        const existingByInvoice = await prisma.lead.findFirst({
          where: { invoiceId: invoice.id },
        });
        if (existingByInvoice) {
          // If this inspection is more recent than the existing lead, update pmName to this tech
          const existingDate = existingByInvoice.inspectionDate ? new Date(existingByInvoice.inspectionDate).getTime() : 0;
          if (inspectionDate.getTime() > existingDate && pmName) {
            await prisma.lead.update({
              where: { id: existingByInvoice.id },
              data: { pmName, inspectionDate, externalId: String(a.appointmentID) },
            });
          }
          updated++; continue;
        }
      }

      const dayStart = new Date(a.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(a.date);
      dayEnd.setHours(23, 59, 59, 999);
      const existingByDate = await prisma.lead.findFirst({
        where: { customerId: customer.id, office, inspectionDate: { gte: dayStart, lte: dayEnd } },
      });
      if (existingByDate) { updated++; continue; }

      await prisma.lead.create({
        data: {
          externalId: String(a.appointmentID),
          office,
          customerId: customer.id,
          pmName,
          inspectionDate,
          status,
          invoiceId: invoice?.id || null,
          amount: invoice ? Number(invoice.amount) : null,
        },
      });
      created++;

      if (status === 'SOLD' && invoice) {
        await createDispatchJob(customer.id, invoice.id, office, pmName, String(a.customerID), key, token);
      }

    } catch (err) {
      errors++;
    }
  }

  console.log(`[${office}] Part 2 complete: ${created} created, ${errors} errors`);
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

// Safety net: find any SOLD lead (with an invoice) in this office that has NO dispatch job, and
// create it. Catches leads that flipped to SOLD before dispatch-job creation existed on their path,
// or any future straggler — regardless of which sync path sold them. Idempotent (createDispatchJob
// guards on customerId+invoiceId).
async function sweepMissingDispatchJobs(office: string, key: string, token: string): Promise<{ checked: number; created: number }> {
  const soldLeads = await prisma.lead.findMany({
    where: { office, status: 'SOLD', invoiceId: { not: null } },
    include: { customer: { select: { externalId: true } } },
  });

  let createdCount = 0;
  for (const lead of soldLeads) {
    const existing = await prisma.dispatchJob.findFirst({
      where: { customerId: lead.customerId, invoiceId: lead.invoiceId! },
    });
    if (existing) continue;
    try {
      await createDispatchJob(
        lead.customerId,
        lead.invoiceId!,
        office,
        lead.pmName,
        lead.customer?.externalId || String(lead.customerId),
        key,
        token,
      );
      createdCount++;
    } catch {
      // non-fatal; next sweep retries
    }
  }
  return { checked: soldLeads.length, created: createdCount };
}

export async function POST(req: NextRequest) {
  // Accept either x-cron-secret header OR Authorization: Bearer <CRON_SECRET>,
  // so all cron-job.org jobs use one uniform header.
  const cronSecret = req.headers.get('x-cron-secret');
  const bearer = req.headers.get('authorization');
  const cronOk = cronSecret === process.env.CRON_SECRET || bearer === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk) {
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
      // Self-heal placeholder "Customer <id>" records created for new leads.
      try {
        results[office].healed = await healPlaceholderCustomers(office, config.key, config.token);
      } catch (e: any) {
        results[office].healed = { error: e.message };
      }
      // Safety net: ensure every SOLD lead has a dispatch job (catches leads that flipped before
      // dispatch-job creation was wired into their path, e.g. pre-fix SOLD leads).
      try {
        results[office].dispatchSweep = await sweepMissingDispatchJobs(office, config.key, config.token);
      } catch (e: any) {
        results[office].dispatchSweep = { error: e.message };
      }
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
