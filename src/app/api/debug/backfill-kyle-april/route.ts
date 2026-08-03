// One-off backfill: Kyle Oktay's (FR employee 10175, DFW) April 2026 wildlife inspections that are
// UNSOLD (no matching sold invoice) — these predate the DFW CSV cutoff (2026-05-28) and weren't in the
// spreadsheet, so they never landed as leads. Sold ones already came via CSV. Scoped tightly so it
// can only ever create Kyle's April unsold INSPECTED leads. Idempotent (skips existing by externalId).
// GET /api/debug/backfill-kyle-april?token=critterstop2026
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const KEY = process.env.FIELDROUTES_KEY_DFW!;
const TOKEN = process.env.FIELDROUTES_TOKEN_DFW!;
const OFFICE = 'DFW';
const KYLE_EMP = '10175';
const WILDLIFE_INSPECTION_IDS = new Set(['645', '1037', '884', '722', '544', '619']);
const SOLD_SERVICE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];

async function frFetch(endpoint: string, params: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${KEY}&authenticationToken=${TOKEN}`;
  const res = await fetch(url);
  return res.json();
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log: string[] = [];
  // April 2026 appointments serviced by Kyle.
  const search = await frFetch('appointment/search', 'dateStart=2026-04-01&dateEnd=2026-04-30');
  const ids: number[] = search.appointmentIDs || [];
  if (!ids.length) return NextResponse.json({ error: 'no April appointments returned', search });

  // Batch-fetch details.
  const appts: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const d = await frFetch('appointment/get', `appointmentIDs=${batch.join(',')}`);
    if (d.appointments) appts.push(...d.appointments);
  }

  // Kyle's wildlife inspections, completed.
  const kyleInsp = appts.filter(a =>
    String(a.servicedBy || a.completedBy) === KYLE_EMP &&
    WILDLIFE_INSPECTION_IDS.has(String(a.type)) &&
    a.status === '1'
  );
  log.push(`Kyle April wildlife inspections found: ${kyleInsp.length}`);

  let created = 0, skippedSold = 0, skippedExisting = 0, noCustomer = 0;
  const details: any[] = [];

  for (const a of kyleInsp) {
    const customer = await prisma.customer.findFirst({ where: { externalId: String(a.customerID), office: OFFICE } });
    if (!customer) { noCustomer++; continue; }

    const inspectionDate = new Date(a.date);
    // Is there a sold invoice for this customer on/after the inspection? -> it's SOLD, skip (already handled).
    const invoice = await prisma.invoice.findFirst({
      where: { customerId: customer.id, office: OFFICE, serviceId: { in: SOLD_SERVICE_IDS },
               date: { gte: new Date(inspectionDate.toISOString().split('T')[0]) } },
    });
    if (invoice) { skippedSold++; continue; }

    // Already exists?
    const existing = await prisma.lead.findFirst({ where: { externalId: String(a.appointmentID) } });
    if (existing) { skippedExisting++; continue; }

    await prisma.lead.create({
      data: {
        externalId: String(a.appointmentID),
        office: OFFICE,
        customerId: customer.id,
        pmName: 'Kyle Oktay',
        inspectionDate,
        status: 'INSPECTED',
        invoiceId: null,
        amount: null,
      },
    });
    created++;
    details.push({ appt: a.appointmentID, date: a.date, customer: customer.name });
  }

  return NextResponse.json({
    ok: true, log,
    summary: { created, skippedSold, skippedExisting, noCustomer },
    createdLeads: details,
  });
}
