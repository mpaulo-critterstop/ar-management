// One-time combined list: still-open close-out jobs (as of today), DFW — jobs ACTIVE in the last 30 days that
// are close-out-eligible but NOT closed out. One row per customer at their most recent close-out visit, with
// customer name, last-visit service type, and the tech who did it.
//   Sources:
//   • Trapping jobs (DispatchJob) with a trap check in the last 30d, not closed out. Tech + name resolved from
//     the customer's latest trap-check appointment (504/636/1076) pulled in bulk from FR.
//   • Call Back-Trap Check (620), Annual Inspection (533), Annual Inspection Trap Check (538) appts in the last
//     30d whose latest such visit was NOT closed out.
//   /api/cron/open-closeout-jobs?token=critterstop2026        (JSON)
//   /api/cron/open-closeout-jobs?token=critterstop2026&csv=1   (CSV)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasCloseoutNote, formWithinWindow, loadCloseoutFormDates } from '@/lib/closeout';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW!, officeId: 1 },
};

const TRAP_CHECK_IDS = [504, 636, 1076];
const APPT_CO_TYPES: Record<number, string> = { 620: 'Call Back - Trap Check', 533: 'Annual Inspection', 538: 'Annual Inspection Trap Check' };
const WINDOW_DAYS = 30;

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
function apptSearchUrl(cfg: any, dateStart: string, dateEnd: string, serviceIDs: string) {
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
  const end = new Date();
  const start = new Date(Date.now() - WINDOW_DAYS * 86400000);

  type Row = { customer: string; frId: string; lastVisitType: string; lastVisitDate: string; tech: string; _date: number };
  const byCustomer = new Map<string, Row>();
  const techIds = new Set<string>();

  // 1) Trapping jobs still open + ACTIVE in last 30d (DispatchJob). externalId = FR customerID.
  const trapJobs = await prisma.dispatchJob.findMany({
    where: { office, hasTrapping: true, trapCheckCount: { gte: 1 }, closedOut: false,
      lastTrapCheck: { gte: start } },
    select: { lastTrapCheck: true, customer: { select: { name: true, externalId: true } } },
  });
  const trapCustIds = new Set<string>();
  for (const j of trapJobs) {
    const frId = String(j.customer?.externalId || '');
    if (!frId) continue;
    trapCustIds.add(frId);
    byCustomer.set(frId, {
      customer: j.customer?.name || '', frId,
      lastVisitType: 'Trap Check', lastVisitDate: j.lastTrapCheck ? fmtDate(new Date(j.lastTrapCheck)) : '',
      tech: '', _date: j.lastTrapCheck ? new Date(j.lastTrapCheck).getTime() : 0,
    });
  }

  // Bulk-pull all DFW trap-check appts in the window → map each customer's LATEST TC's tech (servicedBy) + name.
  const tcSearch = await frFetch(apptSearchUrl(cfg, fmtDate(start), fmtDate(end), TRAP_CHECK_IDS.join(',')));
  const tcAppts = (tcSearch.appointmentIDs || []).length ? await fetchApptsByIds(tcSearch.appointmentIDs, cfg.key, cfg.token) : [];
  const latestTcByCust = new Map<string, any>();
  for (const a of tcAppts) {
    if (String(a.status) !== '1') continue;
    const cust = String(a.customerID);
    const d = new Date(a.date || a.dateAdded).getTime();
    const cur = latestTcByCust.get(cust);
    if (!cur || d > new Date(cur.date || cur.dateAdded).getTime()) latestTcByCust.set(cust, a);
  }
  // Enrich trapping rows with tech + name from their latest TC appt.
  for (const frId of trapCustIds) {
    const a = latestTcByCust.get(frId);
    const row = byCustomer.get(frId);
    if (a && row) {
      const svc = String(a.servicedBy || a.assignedTech || '');
      if (svc) { row.tech = svc; techIds.add(svc); }
      if (!row.customer && a.customerName) row.customer = a.customerName;
      const d = new Date(a.date || a.dateAdded);
      if (d.getTime() > row._date) { row._date = d.getTime(); row.lastVisitDate = fmtDate(d); }
    }
  }

  // 2) 620/533/538 appts in the last 30d, not closed out.
  const search = await frFetch(apptSearchUrl(cfg, fmtDate(start), fmtDate(end), Object.keys(APPT_CO_TYPES).join(',')));
  const appts = (search.appointmentIDs || []).length ? await fetchApptsByIds(search.appointmentIDs, cfg.key, cfg.token) : [];
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
  for (const [cust, a] of latestApptByCust) {
    const apptDate = new Date(a.date || a.dateAdded);
    if (hasCloseoutNote(a) || formWithinWindow(formsByCust.get(cust) || [], apptDate)) continue;
    const typeId = parseInt(String(a.type || a.serviceTypeID || '0'));
    const svc = String(a.servicedBy || a.assignedTech || '');
    if (svc) techIds.add(svc);
    const existing = byCustomer.get(cust);
    if (!existing || apptDate.getTime() > existing._date) {
      byCustomer.set(cust, {
        customer: a.customerName || existing?.customer || '', frId: cust,
        lastVisitType: APPT_CO_TYPES[typeId], lastVisitDate: fmtDate(apptDate), tech: svc, _date: apptDate.getTime(),
      });
    }
  }

  // Backfill any still-blank names from the customers table.
  const blankNameIds = [...byCustomer.values()].filter(r => !r.customer).map(r => r.frId);
  if (blankNameIds.length) {
    const custs = await prisma.customer.findMany({ where: { externalId: { in: blankNameIds } }, select: { externalId: true, name: true } });
    const nameMap = new Map(custs.map(c => [String(c.externalId), c.name]));
    for (const r of byCustomer.values()) if (!r.customer) r.customer = nameMap.get(r.frId) || `FR ${r.frId}`;
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
  return NextResponse.json({ office, windowDays: WINDOW_DAYS, total: rows.length, jobs: rows });
}
