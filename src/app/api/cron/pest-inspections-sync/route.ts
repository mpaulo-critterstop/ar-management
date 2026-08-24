// Pest & Termite Inspection Tracker sync — mirrors the Wildlife Leads Tracker.
// Source: csr_appointments (Pest/Termite inspection types). Each inspection = a row.
// Status: SOLD if the customer has a pest-control-category invoice (matching pest/termite service IDs)
// dated on/after the inspection; else INSPECTED. PM resolved from servicedBy via pmMatcher.
//   /api/cron/pest-inspections-sync?token=critterstop2026
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 500;

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};
async function frGet(ep: string, params: string, key: string, token: string) {
  const r = await fetch(`${FR_BASE}/${ep}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return r.json();
}

// Pest & Termite SOLD service IDs (from real pest_sales data).
const PEST_SOLD_IDS = [162, 529, 165, 616, 547, 495, 292, 1026, 630, 161, 140, 543, 305, 522, 291, 1031, 307, 304, 1034, 309];
const TERMITE_SOLD_IDS = [184, 759];
const ALL_SOLD_IDS = [...PEST_SOLD_IDS, ...TERMITE_SOLD_IDS];

const PEST_INSPECTION_TYPES = ['Pest Inspection', 'Pest Control Inspection', 'Residential Pest Control - Inspection', 'Commercial Pest Control - Inspection'];
const TERMITE_INSPECTION_TYPES = ['Termite Inspection', 'WDI Inspection'];

function pmMatcher(pmNames: string[]) {
  const full = new Map(pmNames.map(n => [n.toLowerCase().trim(), n]));
  const last = new Map<string, string>();
  for (const n of pmNames) { const ln = n.toLowerCase().trim().split(/\s+/).pop()!; if (ln.length > 2 && !last.has(ln)) last.set(ln, n); }
  return (name: string): string | null => {
    const n = (name || '').toLowerCase().trim();
    if (!n) return null;
    if (full.has(n)) return full.get(n)!;
    const ln = n.split(/\s+/).pop()!;
    return last.get(ln) || null;
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const officeParam = sp.get('office');
  const offices = officeParam ? [officeParam] : Object.keys(OFFICES);

  // PM roster + matcher
  const plans = await prisma.commissionPlan.findMany({ select: { pmName: true }, distinct: ['pmName'] });
  const getPM = pmMatcher(plans.map(p => p.pmName).filter(Boolean) as string[]);

  const results: any[] = [];

  for (const office of offices) {
    const cfg = OFFICES[office];
    if (!cfg?.key) continue;

    // 1) Pull pest/termite inspections from csr_appointments for this office.
    const allTypes = [...PEST_INSPECTION_TYPES, ...TERMITE_INSPECTION_TYPES];
    const inspections = await prisma.$queryRawUnsafe(`
      SELECT "externalId", "customerId", "serviceTypeName", "appointmentDate", "servicedBy"
      FROM csr_appointments
      WHERE office = $1 AND "serviceTypeName" = ANY($2)
    `, office, allTypes) as any[];

    // 2) Resolve servicedBy IDs -> names (for PM attribution).
    const empIds = [...new Set(inspections.map(i => String(i.servicedBy)).filter(x => x && x !== 'null' && x !== '0'))];
    const empName = new Map<string, string>();
    for (let k = 0; k < empIds.length; k += 100) {
      const r = await frGet('employee/get', `employeeIDs=${empIds.slice(k, k + 100).join(',')}`, cfg.key, cfg.token);
      for (const e of (r?.employees || [])) empName.set(String(e.employeeID), `${e.fname || ''} ${e.lname || ''}`.trim());
    }

    let created = 0, sold = 0, inspected = 0;

    for (const insp of inspections) {
      const isTermite = TERMITE_INSPECTION_TYPES.includes(insp.serviceTypeName);
      const inspType = isTermite ? 'Termite' : 'Pest';
      const inspDate = insp.appointmentDate ? new Date(insp.appointmentDate) : null;
      const pmNm = insp.servicedBy ? (empName.get(String(insp.servicedBy)) || '') : '';
      const pm = getPM(pmNm);

      // 3) Resolve the customer (FR id -> internal) and look for a pest SOLD invoice.
      const customer = await prisma.customer.findFirst({
        where: { externalId: String(insp.customerId), office }, select: { id: true, name: true },
      });
      let status = 'INSPECTED', soldInvoiceId: string | null = null, soldAmount: number | null = null, soldServiceId: number | null = null, soldDate: Date | null = null;
      if (customer) {
        const invoice = await prisma.invoice.findFirst({
          where: {
            customerId: customer.id, office, serviceId: { in: ALL_SOLD_IDS }, amount: { gt: 0 },
            ...(inspDate && { date: { gte: new Date(inspDate.toISOString().split('T')[0]) } }),
          },
          orderBy: { date: 'asc' },
        });
        if (invoice) {
          status = 'SOLD'; soldInvoiceId = invoice.id; soldAmount = Number(invoice.amount);
          soldServiceId = invoice.serviceId; soldDate = invoice.due || invoice.date;
        }
      }

      const id = `pinsp_${insp.externalId}`;
      await prisma.pestInspection.upsert({
        where: { externalId: String(insp.externalId) },
        create: {
          id, office, externalId: String(insp.externalId), customerId: String(insp.customerId),
          customerName: customer?.name || null, inspectionType: inspType, serviceTypeName: insp.serviceTypeName,
          inspectionDate: inspDate, servicedBy: insp.servicedBy ? String(insp.servicedBy) : null, pmName: pm,
          status, soldInvoiceId, soldAmount, soldServiceId, soldDate,
        },
        update: {
          inspectionType: inspType, serviceTypeName: insp.serviceTypeName, inspectionDate: inspDate,
          servicedBy: insp.servicedBy ? String(insp.servicedBy) : null, pmName: pm, customerName: customer?.name || null,
          status, soldInvoiceId, soldAmount, soldServiceId, soldDate,
        },
      });
      created++;
      if (status === 'SOLD') sold++; else inspected++;
    }

    results.push({ office, inspections: inspections.length, upserted: created, sold, inspected });
  }

  return NextResponse.json({ ok: true, results });
}
