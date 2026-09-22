// One-time combined list: still-open close-out jobs (as of today), DFW.
// Includes BOTH:
//   • Trapping jobs (from DispatchJob) that are close-out-eligible (have trap checks) and not closed out.
//   • Call Back-Trap Check (620), Annual Inspection (533), Annual Inspection Trap Check (538) appointments in
//     the last 30 days whose latest such visit was NOT closed out (no note, no template-86 form).
// Deduped to one row per customer at their MOST RECENT close-out visit. Shows: customer, last-visit service
// type, and the tech (servicedBy) who did that last visit.
//   /api/cron/open-closeout-jobs?token=critterstop2026         (JSON)
//   /api/cron/open-closeout-jobs?token=critterstop2026&csv=1    (CSV)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasCloseoutNote, formWithinWindow, loadCloseoutFormDates } from '@/lib/closeout';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW!, officeId: 1 },
};

// Appointment-based close-out service types (per Mark): 620 Call Back-Trap Check, 533 Annual Inspection,
// 538 Annual Inspection Trap Check.
const APPT_CO_TYPES: Record<number, string> = { 620: 'Call Back - Trap Check', 533: 'Annual Inspection', 538: 'Annual Inspection Trap Check' };

let frChain: Promise<any> = Promise.resolve();
function frFetch(url: string): Promise<any> {
  const run = frChain.then(async () => { await new Promise(r => setTimeout(r, 1100)); const r = await fetch(url); return r.json(); });
  frChain = run.catch(() => {});
  return run;
}
async function fetchApptsByIds(ids: number[], key: string, token: string): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const data = await frFetch(`${BASE_URL}/appointment/get?appointmentIDs=${idParam}&authenticationKey=${key}&authenticationToken=${token}`);
    if (Array.isArray(data.appointments)) out.push(...data.appointments);
  }
  return out;
}
function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }

function frUrlSearch(cfg: { key: string; token: string; officeId: number }, dateStart: string, dateEnd: string, serviceIDs: string) {
  const u = new URL(`${BASE_URL}/appointment/search`);
  u.searchParams.set('officeIDs', String(cfg.officeId));
  u.searchParams.set('serviceIDs', serviceIDs);
  u.searchParams.set('dateStart', dateStart);
  u.searchParams.set('dateEnd', dateEnd);
  u.searchParams.set('status', '1');
  u.searchParams.set('authenticationKey', cfg.key);
  u.searchParams.set('authenticationToken', cfg.token);
  return u.toString();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== process.env.CRON_SECRET && sp.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const office = 'DFW';
  const asCsv = sp.get('csv') === '1';
  const cfg = OFFICES[office];

  type Row = { customer: string; frId: string; lastVisitType: string; lastVisitDate: string; tech: string; _date: number };
  const byCustomer = new Map<string, Row>();

  // 1) Trapping jobs still open (DispatchJob).
  const trapJobs = await prisma.dispatchJob.findMany({
    where: { office, hasTrapping: true, trapCheckCount: { gte: 1 }, closedOut: false },
    select: { pmName: true, trapCheckCount: true, lastTrapCheck: true, customer: { select: { name: true, externalId: true } } },
  });
  for (const j of trapJobs) {
    const frId = String(j.customer?.externalId || '');
    if (!frId) continue;
    byCustomer.set(frId, {
      customer: j.customer?.name || 'Unknown', frId,
      lastVisitType: 'Trap Check', lastVisitDate: j.lastTrapCheck ? fmtDate(new Date(j.lastTrapCheck)) : '',
      tech: '', _date: j.lastTrapCheck ? new Date(j.lastTrapCheck).getTime() : 0,
    });
  }

  // 2) 620/533/538 appointments in the last 30 days, not closed out.
  const end = new Date();
  const start = new Date(Date.now() - 30 * 86400000);
  const typeCsv = Object.keys(APPT_CO_TYPES).join(',');
  const search = await frFetch(frUrlSearch(cfg, fmtDate(start), fmtDate(end), typeCsv));
  const apptIds: number[] = search.appointmentIDs || [];
  const appts = apptIds.length ? await fetchApptsByIds(apptIds, cfg.key, cfg.token) : [];
  const coAppts = appts.filter(a => String(a.status) === '1' && APPT_CO_TYPES[parseInt(String(a.type || a.serviceTypeID || '0'))]);

  const custIds = [...new Set(coAppts.map(a => String(a.customerID)).filter(x => x && x !== '0'))];
  const formsByCust = await loadCloseoutFormDates(prisma, custIds);

  const latestApptByCust = new Map<string, any>();
  for (const a of coAppts) {
    const cust = String(a.customerID);
    const d = new Date(a.date || a.dateAdded).getTime();
    const cur = latestApptByCust.get(cust);
    if (!cur || d > new Date(cur.date || cur.dateAdded).getTime()) latestApptByCust.set(cust, a);
  }

  const techIds = new Set<string>();
  for (const [cust, a] of latestApptByCust) {
    const apptDate = new Date(a.date || a.dateAdded);
    const closed = hasCloseoutNote(a) || formWithinWindow(formsByCust.get(cust) || [], apptDate);
    if (closed) continue;
    const typeId = parseInt(String(a.type || a.serviceTypeID || '0'));
    const svc = String(a.servicedBy || a.assignedTech || '');
    if (svc) techIds.add(svc);
    const existing = byCustomer.get(cust);
    if (!existing || apptDate.getTime() > existing._date) {
      byCustomer.set(cust, {
        customer: a.customerName || cust, frId: cust,
        lastVisitType: APPT_CO_TYPES[typeId], lastVisitDate: fmtDate(apptDate),
        tech: svc, _date: apptDate.getTime(),
      });
    }
  }

  // Resolve tech IDs -> names.
  const techNames = new Map<string, string>();
  const allTechIds = [...techIds].filter(Boolean);
  if (allTechIds.length) {
    const idParam = allTechIds.length === 1 ? `${allTechIds[0]},${allTechIds[0]}` : allTechIds.join(',');
    const er = await frFetch(`${BASE_URL}/employee/get?employeeIDs=${idParam}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`);
    for (const e of (er?.employees || [])) techNames.set(String(e.employeeID), `${e.fname || ''} ${e.lname || ''}`.trim());
  }

  const rows = [...byCustomer.values()]
    .map(r => ({ customer: r.customer, frId: r.frId, lastVisitType: r.lastVisitType, lastVisitDate: r.lastVisitDate, tech: r.tech ? (techNames.get(r.tech) || `#${r.tech}`) : '' }))
    .sort((a, b) => (b.lastVisitDate < a.lastVisitDate ? -1 : 1));

  if (asCsv) {
    const header = 'Customer,FR ID,Last Visit Type,Last Visit Date,Tech';
    const lines = rows.map(r => [r.customer, r.frId, r.lastVisitType, r.lastVisitDate, r.tech].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    return new NextResponse([header, ...lines].join('\n'), {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="open-closeout-jobs-${office}.csv"` },
    });
  }
  return NextResponse.json({ office, total: rows.length, jobs: rows });
}
