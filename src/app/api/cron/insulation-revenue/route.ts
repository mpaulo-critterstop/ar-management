// Insulation Revenue per Tech report.
// For a period (week starting Monday, or month), across all offices:
//   • Find insulation-group route appointments (FAR/insulation work days).
//   • Group a customer's insulation days into ONE job (one FAR invoice per customer).
//   • Insulation revenue = sum of that customer's invoice line items with productID 10 (Full Attic Restoration)
//     or 43 (Insulation Top-Off).
//   • Total tech-days = sum of each work day's crew size (route additionalTechs count, fallback assignedTech).
//   • Revenue per tech = insulation revenue / total tech-days.
// Labor-cost columns are left blank (wages/benefits are not in FR) for manual entry -> Direct Labor %.
//
//   /api/cron/insulation-revenue?token=critterstop2026&period=week&date=2026-09-22   (week containing that date)
//   /api/cron/insulation-revenue?token=critterstop2026&period=month&date=2026-09-01
//   ...&office=DFW   (single office; default all)   ...&csv=1
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { waitUntil } from '@vercel/functions';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};
const INSULATION_PRODUCT_IDS = new Set([10, 43]); // 10 Full Attic Restoration, 43 Insulation Top-Off

let chain: Promise<any> = Promise.resolve();
function fr(url: string): Promise<any> {
  const run = chain.then(async () => { await new Promise(r => setTimeout(r, 1100)); const r = await fetch(url); return r.json(); });
  chain = run.catch(() => {});
  return run;
}
const fmt = (d: Date) => d.toISOString().split('T')[0];

// FR appointment/search only reliably honors ONE serviceID in a comma list (same multi-value quirk as
// customerIDs/routeIDs). So search each insulation service type separately and merge the appointment IDs.
async function searchApptIdsByServiceTypes(cfg: any, extraParams: string, serviceIds: number[]): Promise<number[]> {
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  const all = new Set<number>();
  for (const sid of serviceIds) {
    const s = await fr(`${BASE_URL}/appointment/search?${extraParams}&serviceIDs=${sid}&${auth}`);
    for (const id of (s.appointmentIDs || [])) all.add(Number(id));
  }
  return [...all];
}

// Get a customer's invoice/ticket externalIDs from the Hub DB (reliable for old invoices, unlike FR
// ticket/search which misses tickets outside its recent window). custExtId = FR customerID.
async function customerTicketIds(custExtId: string): Promise<string[]> {
  const invs = await prisma.invoice.findMany({
    where: { customer: { externalId: custExtId }, externalId: { not: null } },
    select: { externalId: true },
  });
  return invs.map(i => i.externalId!).filter(Boolean);
}

// Monday-start week bounds containing `d`; or month bounds.
function periodBounds(period: string, d: Date): { start: Date; end: Date; label: string } {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (period === 'month') {
    const start = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
    const end = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
    return { start, end, label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  const day = dt.getUTCDay(); // 0 Sun..6 Sat
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const start = new Date(dt); start.setUTCDate(dt.getUTCDate() + diffToMon);
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  return { start, end, label: `Wk of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` };
}

async function fetchByIds(entity: string, idParamName: string, ids: any[], key: string, token: string): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const d = await fr(`${BASE_URL}/${entity}/get?${idParamName}=${idParam}&authenticationKey=${key}&authenticationToken=${token}`);
    const prop = d.propertyName || `${entity}s`;
    if (Array.isArray(d[prop])) out.push(...d[prop]);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== process.env.CRON_SECRET && sp.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // FAST VALIDATION: one route → its appts → each customer's FAR invoice revenue. Confirms the logic quickly.
  const debugRoute = sp.get('debugRoute');
  const debugOffice = sp.get('office') || 'DFW';
  const debugCust = sp.get('debugCust');
  if (debugCust) {
    const cfg = OFFICES[debugOffice]; const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const s = await fr(`${BASE_URL}/appointment/search?customerIDs=${debugCust}&dateStart=2026-01-01&dateEnd=2026-12-31&${auth}`);
    const ids: any[] = s.appointmentIDs || [];
    const appts = ids.length ? await fetchByIds('appointment', 'appointmentIDs', ids, cfg.key, cfg.token) : [];
    return NextResponse.json({ debugCust, count: appts.length, appts: appts.map((a: any) => ({ appointmentID: a.appointmentID, date: a.date, type: a.type || a.serviceTypeID, status: a.status, statusText: a.statusText, routeID: a.routeID, servicedBy: a.servicedBy, serviceType: a.serviceType })) });
  }
  if (debugRoute) {
    const cfg = OFFICES[debugOffice]; const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const rg = await fr(`${BASE_URL}/route/get?routeIDs=${debugRoute},${debugRoute}&${auth}`);
    const r = (rg.routes || [])[0];
    if (!r) return NextResponse.json({ error: 'route not found' });
    const crew = (r.additionalTechs ? String(r.additionalTechs).split(',').map((s: string) => s.trim()).filter(Boolean) : []);
    // Always include the assignedTech (the servicing tech) — it isn't always duplicated into additionalTechs.
    if (r.assignedTech && String(r.assignedTech) !== '0') crew.push(String(r.assignedTech));
    const as = await fr(`${BASE_URL}/appointment/search?routeIDs=${debugRoute}&${auth}`);
    const appts = (as.appointmentIDs || []).length ? await fetchByIds('appointment', 'appointmentIDs', as.appointmentIDs, cfg.key, cfg.token) : [];
    const out: any[] = [];
    for (const a of appts) {
      const custID = String(a.customerID); if (!custID || custID === '0') continue;
      const tIds = await customerTicketIds(custID);
      const tickets = tIds.length ? await fetchByIds('ticket', 'ticketIDs', tIds, cfg.key, cfg.token) : [];
      let rev = 0; const farLines: any[] = [];
      for (const t of tickets) for (const it of (t.items || [])) {
        if (INSULATION_PRODUCT_IDS.has(parseInt(String(it.productID)))) { rev += parseFloat(it.amount || '0'); farLines.push({ ticketID: t.ticketID, productID: it.productID, desc: it.description, amount: it.amount }); }
      }
      out.push({ customer: a.customerName || custID, customerID: custID, apptStatus: a.status, insulationRevenue: Math.round(rev * 100) / 100, farLines });
    }
    return NextResponse.json({ debugRoute, routeDate: r.date, routeGroup: r.groupTitle, crew, crewSize: crew.length, appts: out });
  }

  const period = sp.get('period') === 'month' ? 'month' : 'week';
  const dateParam = sp.get('date');
  const anchor = dateParam ? new Date(dateParam + 'T12:00:00Z') : new Date();
  const { start, end, label } = periodBounds(period, anchor);
  const officeParam = sp.get('office');
  const asCsv = sp.get('csv') === '1';
  const refresh = sp.get('refresh') === '1';
  const periodKey = period === 'month' ? label : fmt(start);

  // Offices to act on. Read/CSV default to DFW (a single office — per-office reporting). Refresh with no office
  // does ALL offices (each cached separately).
  const readOffice = officeParam || 'DFW';
  const refreshOffices = officeParam ? [officeParam] : Object.keys(OFFICES);

  // DEFAULT: read one office's cached result (instant, no FR).
  if (!refresh && !asCsv) {
    const cached = await prisma.insulationRevenueCache.findUnique({ where: { period_periodKey_office: { period, periodKey, office: readOffice } } });
    if (cached) return NextResponse.json({ period, office: readOffice, periodLabel: cached.periodLabel, start: fmt(cached.rangeStart), end: fmt(cached.rangeEnd), cached: true, computedAt: cached.computedAt, totals: cached.totals, rows: cached.rows });
    return NextResponse.json({ period, office: readOffice, periodLabel: label, start: fmt(start), end: fmt(end), cached: false, note: 'Not computed yet — run with &refresh=1 (or wait for the nightly job).', totals: { jobs: 0, totalRevenue: 0, totalTechDays: 0 }, rows: [] });
  }

  // REFRESH: compute each requested office SEPARATELY (background), one cache row per office.
  if (refresh && !asCsv) {
    // Periods to compute this run. With no explicit date, also refresh the PREVIOUS period so the tail of a
    // month/week (days after the last scheduled Sunday run) still gets a final refresh once it's rolled over.
    const targets: { periodKey: string; start: Date; end: Date; label: string }[] = [{ periodKey, start, end, label }];
    if (!dateParam) {
      const prevAnchor = period === 'month'
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 15))
        : new Date(start.getTime() - 7 * 86400000);
      const pb = periodBounds(period, prevAnchor);
      const prevKey = period === 'month' ? pb.label : fmt(pb.start);
      targets.push({ periodKey: prevKey, start: pb.start, end: pb.end, label: pb.label });
    }
    waitUntil((async () => {
      const setStatus = (m: string) => prisma.appSetting.upsert({ where: { key: 'insulation_revenue_status' }, create: { key: 'insulation_revenue_status', value: m }, update: { value: m } }).catch(() => {});
      try {
        for (const t of targets) {
          for (const office of refreshOffices) {
            await setStatus(`running: ${office} ${period} ${t.periodKey} @ ${new Date().toISOString()}`);
            const result = await runReport(period, t.start, t.end, t.label, [office]);
            await prisma.insulationRevenueCache.upsert({
              where: { period_periodKey_office: { period, periodKey: t.periodKey, office } },
              create: { period, periodKey: t.periodKey, office, periodLabel: t.label, rangeStart: t.start, rangeEnd: t.end, rows: result.rows as any, totals: result.totals as any },
              update: { periodLabel: t.label, rangeStart: t.start, rangeEnd: t.end, rows: result.rows as any, totals: result.totals as any, computedAt: new Date() },
            });
          }
        }
        await setStatus(`done: ${refreshOffices.join(',')} ${period} [${targets.map(t => t.periodKey).join(', ')}] @ ${new Date().toISOString()}`);
      } catch (e: any) {
        await setStatus(`ERROR: ${period} ${periodKey} — ${String(e).slice(0, 400)} @ ${new Date().toISOString()}`);
        console.error('insulation-revenue refresh error:', e);
      }
    })());
    return NextResponse.json({ ok: true, started: true, period, periodKeys: targets.map(t => t.periodKey), offices: refreshOffices, note: 'Computing per office (current + previous period) in background. Reload (without refresh) in a few minutes.' });
  }

  // CSV: one office (cache if present, else compute live).
  const cachedForCsv = await prisma.insulationRevenueCache.findUnique({ where: { period_periodKey_office: { period, periodKey, office: readOffice } } });
  const data = cachedForCsv ? { rows: cachedForCsv.rows as any[], totals: cachedForCsv.totals } : await runReport(period, start, end, label, [readOffice]);
  const rows = data.rows as any[];
  {
    const header = 'Office,Customer,FR ID,First Day,Last Day,Days,Tech-Days,Unique Techs,Insulation Revenue,Revenue per Tech,Direct Labor Cost,Direct Labor %';
    const lines = rows.map(r => [r.office, r.customer, r.customerID, r.firstDay, r.lastDay, r.days, r.techDays, r.uniqueTechs, r.insulationRevenue, r.revenuePerTech, '', '']
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    return new NextResponse([header, ...lines].join('\n'), {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="insulation-revenue-${period}-${fmt(start)}.csv"` },
    });
  }
}

async function runReport(period: string, start: Date, end: Date, label: string, offices: string[]) {
  type Job = { office: string; customerID: string; customer: string; days: number; techDays: number; techIds: Set<string>;
               firstDay: string; lastDay: string; revenue: number | null; };
  const jobs = new Map<string, Job>(); // key office:customerID
  const inProgressCustomers = new Set<string>();

  // Insulation appointment service types (per Mark):
  // 624 Blow-In Cellulose (final), 542 Blow-In Fiberglass (final), 541 Removal (early, 1-3 days),
  // 479 Removal+Blow-In (single-day FAR), 1073 Removal ONLY, 674 Top-Off.
  const INS_TYPES = new Set([624, 542, 541, 479, 1073, 674]);
  const FINAL_TYPES = new Set([624, 542, 479, 1073, 674]); // completes a job (541 removal alone does not)
  const INS_TYPE_CSV = '624,542,541,479,1073,674';

  for (const officeName of offices) {
    const cfg = OFFICES[officeName]; if (!cfg?.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

    // 1) All insulation appointments in the window (by service type — searched per-type due to FR quirk).
    const apptIds: any[] = await searchApptIdsByServiceTypes(cfg, `officeIDs=${cfg.officeId}&dateStart=${fmt(start)}&dateEnd=${fmt(end)}`, [...INS_TYPES]);
    if (!apptIds.length) continue;
    const appts = await fetchByIds('appointment', 'appointmentIDs', apptIds, cfg.key, cfg.token);

    // 2) Crew per route (route additionalTechs). Collect the routes these appts sit on.
    const routeIds = [...new Set(appts.map((a: any) => String(a.routeID)).filter(x => x && x !== '0'))];
    const routes = routeIds.length ? await fetchByIds('route', 'routeIDs', routeIds, cfg.key, cfg.token) : [];
    const crewByRoute = new Map<string, string[]>();
    for (const r of routes) {
      const crew = (r.additionalTechs ? String(r.additionalTechs).split(',').map((s: string) => s.trim()).filter(Boolean) : []);
      if (r.assignedTech && String(r.assignedTech) !== '0') crew.push(String(r.assignedTech));
      crewByRoute.set(String(r.routeID), [...new Set(crew)]);
    }

    // 3) Build jobs from completed insulation appts; flag customers with any non-completed ins appt (in progress).
    for (const a of appts) {
      const typeId = parseInt(String(a.type || a.serviceTypeID || '0'));
      if (!INS_TYPES.has(typeId)) continue;
      const custID = String(a.customerID); if (!custID || custID === '0') continue;
      const key = `${officeName}:${custID}`;
      if (String(a.status) !== '1') { inProgressCustomers.add(key); continue; } // pending/scheduled -> in progress
      const crew = crewByRoute.get(String(a.routeID)) || [];
      const date = String(a.date || a.dateAdded).slice(0, 10);
      let job = jobs.get(key);
      if (!job) { job = { office: officeName, customerID: custID, customer: a.customerName || custID, days: 0, techDays: 0, techIds: new Set(), firstDay: date, lastDay: date, revenue: null }; jobs.set(key, job); }
      job.days += 1;
      job.techDays += crew.length;
      crew.forEach(t => job!.techIds.add(t));
      if (date < job.firstDay) job.firstDay = date;
      if (date > job.lastDay) job.lastDay = date;
    }
  }

  // 4) Completion check (Option C): a job counts only when fully done. Exclude if there's any pending in-window
  // insulation appt (flagged above) OR any pending/future insulation appt after the window (removal done but
  // blow-in still upcoming). Look forward ~60 days.
  const futureStart = fmt(new Date(end.getTime() + 86400000));
  const futureEnd = fmt(new Date(end.getTime() + 60 * 86400000));
  for (const [key, job] of jobs) {
    if (inProgressCustomers.has(key)) continue;
    const cfg = OFFICES[job.office]; const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const futIds: any[] = await searchApptIdsByServiceTypes(cfg, `customerIDs=${job.customerID}&dateStart=${futureStart}&dateEnd=${futureEnd}`, [...INS_TYPES]);
    if (futIds.length) {
      const futAppts = await fetchByIds('appointment', 'appointmentIDs', futIds, cfg.key, cfg.token);
      if (futAppts.some((a: any) => INS_TYPES.has(parseInt(String(a.type || a.serviceTypeID || '0'))) && String(a.status) !== '1')) inProgressCustomers.add(key);
    }
  }
  for (const key of inProgressCustomers) jobs.delete(key);

  // 3) Per job: pull the customer's FAR invoice line items (productID 10/43) and sum.
  for (const job of jobs.values()) {
    const cfg = OFFICES[job.office]; const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const tIds = await customerTicketIds(job.customerID);
    if (!tIds.length) { job.revenue = 0; continue; }
    const tickets = await fetchByIds('ticket', 'ticketIDs', tIds, cfg.key, cfg.token);
    let rev = 0; let found = false;
    for (const t of tickets) {
      const items = t.items || [];
      if (items.length) {
        // Itemized: sum the FAR (10) + Top-Off (43) line items only (excludes bundled trapping/exclusion).
        for (const it of items) {
          if (INSULATION_PRODUCT_IDS.has(parseInt(String(it.productID)))) { rev += parseFloat(it.amount || '0'); found = true; }
        }
      } else if (parseInt(String(t.serviceID)) === 501) {
        // Itemless AND serviceID 501 (Full Attic Restoration) = solely-insulation invoice -> use the total.
        rev += parseFloat(t.total || '0'); found = true;
      }
    }
    job.revenue = found ? Math.round(rev * 100) / 100 : 0;
  }

  // Backfill customer names (appointment customerName is often blank -> shows as ID).
  const needName = [...jobs.values()].filter(j => !j.customer || j.customer === j.customerID).map(j => j.customerID);
  if (needName.length) {
    const custs = await prisma.customer.findMany({ where: { externalId: { in: needName } }, select: { externalId: true, name: true } });
    const nameMap = new Map(custs.map(c => [String(c.externalId), c.name]));
    for (const j of jobs.values()) if (!j.customer || j.customer === j.customerID) j.customer = nameMap.get(j.customerID) || `FR ${j.customerID}`;
  }

  const rows = [...jobs.values()].map(j => ({
    office: j.office, customer: j.customer, customerID: j.customerID,
    firstDay: j.firstDay, lastDay: j.lastDay, days: j.days,
    techDays: j.techDays, uniqueTechs: j.techIds.size,
    insulationRevenue: j.revenue ?? 0,
    revenuePerTech: j.techDays > 0 ? Math.round(((j.revenue ?? 0) / j.techDays) * 100) / 100 : 0,
  })).sort((a, b) => b.insulationRevenue - a.insulationRevenue);

  const totals = {
    jobs: rows.length,
    totalRevenue: Math.round(rows.reduce((s, r) => s + r.insulationRevenue, 0) * 100) / 100,
    totalTechDays: rows.reduce((s, r) => s + r.techDays, 0),
  };

  return { rows, totals };
}
