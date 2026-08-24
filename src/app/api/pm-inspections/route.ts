// Pest & Termite inspection close-rate per PM.
// Denominator: pest/termite inspections from csr_appointments, attributed to the PM via servicedBy.
// Numerator: pest/termite sales per PM from pest_sales.
//   /api/pm-inspections?from=2026-01-01&to=2026-08-31&types=pest,termite
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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

// PM matcher (same approach as pest-sales-sync): match a resolved employee name to a known PM.
function pmMatcher(pmNames: string[]) {
  const full = new Map(pmNames.map(n => [n.toLowerCase().trim(), n]));
  const last = new Map<string, string>();
  for (const n of pmNames) { const ln = n.toLowerCase().trim().split(/\s+/).pop()!; if (ln.length > 2 && !last.has(ln)) last.set(ln, n); }
  return (name: string): string | null => {
    const n = (name || '').toLowerCase().trim();
    if (!n) return null;
    if (full.has(n)) return full.get(n)!;
    const ln = n.split(/\s+/).pop()!;
    if (last.has(ln)) return last.get(ln)!;
    return null;
  };
}

const PEST_TYPES = new Set(['Pest Inspection', 'Pest Control Inspection', 'Residential Pest Control - Inspection', 'Commercial Pest Control - Inspection']);
const TERMITE_TYPES = new Set(['Termite Inspection', 'WDI Inspection']);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get('from') || '2026-01-01';
  const to = sp.get('to') || new Date().toISOString().slice(0, 10);
  const typesParam = (sp.get('types') || 'pest,termite').toLowerCase();
  const wantPest = typesParam.includes('pest');
  const wantTermite = typesParam.includes('termite');

  const typeNames: string[] = [];
  if (wantPest) typeNames.push(...PEST_TYPES);
  if (wantTermite) typeNames.push(...TERMITE_TYPES);

  // 1) PM roster
  const plans = await prisma.commissionPlan.findMany({ select: { pmName: true }, distinct: ['pmName'] });
  const pmNames = plans.map(p => p.pmName).filter(Boolean) as string[];
  const getPM = pmMatcher(pmNames);

  // 2) Inspections in range, of the requested types, with a servicedBy.
  const inspections = await prisma.$queryRawUnsafe(`
    SELECT "office", "servicedBy", "serviceTypeName", "customerId", "appointmentDate"
    FROM csr_appointments
    WHERE "serviceTypeName" = ANY($1)
      AND "appointmentDate" >= $2::date AND "appointmentDate" < ($3::date + interval '1 day')
      AND "servicedBy" IS NOT NULL
  `, typeNames, from, to) as any[];

  // 3) Resolve distinct servicedBy IDs -> names (per office, via FR employee/get).
  const byOffice: Record<string, Set<string>> = {};
  for (const i of inspections) { (byOffice[i.office] ||= new Set()).add(String(i.servicedBy)); }
  const empName = new Map<string, string>(); // office:id -> name
  for (const [office, idset] of Object.entries(byOffice)) {
    const cfg = OFFICES[office]; if (!cfg?.key) continue;
    const ids = [...idset];
    for (let k = 0; k < ids.length; k += 100) {
      const r = await frGet('employee/get', `employeeIDs=${ids.slice(k, k + 100).join(',')}`, cfg.key, cfg.token);
      for (const e of (r?.employees || [])) empName.set(`${office}:${e.employeeID}`, `${e.fname || ''} ${e.lname || ''}`.trim());
    }
  }

  // 4) Tally inspections per PM (pest vs termite).
  const stats: Record<string, { pm: string; pestInsp: number; termiteInsp: number; pestSales: number; termiteSales: number }> = {};
  const ensure = (pm: string) => (stats[pm] ||= { pm, pestInsp: 0, termiteInsp: 0, pestSales: 0, termiteSales: 0 });
  let unattributed = 0;
  for (const i of inspections) {
    const nm = empName.get(`${i.office}:${i.servicedBy}`) || '';
    const pm = getPM(nm);
    if (!pm) { unattributed++; continue; }
    const s = ensure(pm);
    if (TERMITE_TYPES.has(i.serviceTypeName)) s.termiteInsp++;
    else s.pestInsp++;
  }

  // 5) Pest/termite SALES per PM in the same window (numerator).
  const sales = await prisma.pestSale.findMany({
    where: { sellerType: 'pm', pmName: { not: null }, saleDate: { gte: new Date(from), lte: new Date(to + 'T23:59:59') } },
    select: { pmName: true, category: true },
  });
  for (const s of sales) {
    const pm = s.pmName!; const st = ensure(pm);
    if ((s.category || '').toLowerCase().includes('termite')) st.termiteSales++;
    else st.pestSales++;
  }

  const rows = Object.values(stats).map(s => {
    const totalInsp = s.pestInsp + s.termiteInsp;
    const totalSales = s.pestSales + s.termiteSales;
    return {
      pm: s.pm,
      pestInspections: s.pestInsp, termiteInspections: s.termiteInsp, totalInspections: totalInsp,
      pestSales: s.pestSales, termiteSales: s.termiteSales, totalSales,
      closeRate: totalInsp > 0 ? Math.round((totalSales / totalInsp) * 1000) / 10 : null,
    };
  }).sort((a, b) => b.totalInspections - a.totalInspections);

  return NextResponse.json({ from, to, types: { pest: wantPest, termite: wantTermite }, unattributedInspections: unattributed, pms: rows });
}
