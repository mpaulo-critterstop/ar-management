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
  if (debugRoute) {
    const cfg = OFFICES[debugOffice]; const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const rg = await fr(`${BASE_URL}/route/get?routeIDs=${debugRoute},${debugRoute}&${auth}`);
    const r = (rg.routes || [])[0];
    if (!r) return NextResponse.json({ error: 'route not found' });
    const crew = (r.additionalTechs ? String(r.additionalTechs).split(',').map((s: string) => s.trim()).filter(Boolean) : []);
    if (!crew.length && r.assignedTech && String(r.assignedTech) !== '0') crew.push(String(r.assignedTech));
    const as = await fr(`${BASE_URL}/appointment/search?routeIDs=${debugRoute}&${auth}`);
    const appts = (as.appointmentIDs || []).length ? await fetchByIds('appointment', 'appointmentIDs', as.appointmentIDs, cfg.key, cfg.token) : [];
    const out: any[] = [];
    for (const a of appts) {
      const custID = String(a.customerID); if (!custID || custID === '0') continue;
      const ts = await fr(`${BASE_URL}/ticket/search?customerID=${custID}&${auth}`);
      const tickets = (ts.ticketIDs || []).length ? await fetchByIds('ticket', 'ticketIDs', ts.ticketIDs, cfg.key, cfg.token) : [];
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
  const offices = sp.get('office') ? [sp.get('office')!] : Object.keys(OFFICES);
  const asCsv = sp.get('csv') === '1';

  type Job = { office: string; customerID: string; customer: string; days: number; techDays: number; techIds: Set<string>;
               firstDay: string; lastDay: string; revenue: number | null; };
  const jobs = new Map<string, Job>(); // key office:customerID

  for (const officeName of offices) {
    const cfg = OFFICES[officeName]; if (!cfg?.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

    // 1) Insulation-group routes in the period.
    const rs = await fr(`${BASE_URL}/route/search?officeIDs=${cfg.officeId}&dateStart=${fmt(start)}&dateEnd=${fmt(end)}&${auth}`);
    const routeIds: string[] = (rs.routeIDs || []).map(String);
    const routes = routeIds.length ? await fetchByIds('route', 'routeIDs', routeIds, cfg.key, cfg.token) : [];
    const insRoutes = routes.filter((r: any) => String(r.groupTitle || '').toLowerCase().includes('insulation'));

    // Map routeID -> { date, crewCount } (crew = unique additionalTechs, fallback assignedTech).
    const routeInfo = new Map<string, { date: string; crew: string[] }>();
    for (const r of insRoutes) {
      const crew = (r.additionalTechs ? String(r.additionalTechs).split(',').map((s: string) => s.trim()).filter(Boolean) : []);
      if (!crew.length && r.assignedTech && String(r.assignedTech) !== '0') crew.push(String(r.assignedTech));
      routeInfo.set(String(r.routeID), { date: String(r.date), crew: [...new Set(crew)] });
    }

    // 2) Appointments on those insulation routes (per route to avoid multi-value quirks).
    for (const [routeID, info] of routeInfo) {
      const as = await fr(`${BASE_URL}/appointment/search?routeIDs=${routeID}&${auth}`);
      const apptIds: any[] = as.appointmentIDs || [];
      if (!apptIds.length) continue;
      const appts = await fetchByIds('appointment', 'appointmentIDs', apptIds, cfg.key, cfg.token);
      for (const a of appts) {
        if (String(a.status) !== '1') continue; // completed only
        const custID = String(a.customerID); if (!custID || custID === '0') continue;
        const key = `${officeName}:${custID}`;
        let job = jobs.get(key);
        if (!job) {
          job = { office: officeName, customerID: custID, customer: a.customerName || custID, days: 0, techDays: 0, techIds: new Set(), firstDay: info.date, lastDay: info.date, revenue: null };
          jobs.set(key, job);
        }
        // count this day once per route-day for the customer
        job.days += 1;
        job.techDays += info.crew.length;
        info.crew.forEach(t => job!.techIds.add(t));
        if (info.date < job.firstDay) job.firstDay = info.date;
        if (info.date > job.lastDay) job.lastDay = info.date;
      }
    }
  }

  // 3) Per job: pull the customer's FAR invoice line items (productID 10/43) and sum.
  for (const job of jobs.values()) {
    const cfg = OFFICES[job.office]; const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const ts = await fr(`${BASE_URL}/ticket/search?customerID=${job.customerID}&${auth}`);
    const tIds: any[] = ts.ticketIDs || [];
    if (!tIds.length) { job.revenue = 0; continue; }
    const tickets = await fetchByIds('ticket', 'ticketIDs', tIds, cfg.key, cfg.token);
    let rev = 0; let found = false;
    for (const t of tickets) {
      for (const it of (t.items || [])) {
        if (INSULATION_PRODUCT_IDS.has(parseInt(String(it.productID)))) { rev += parseFloat(it.amount || '0'); found = true; }
      }
    }
    job.revenue = found ? Math.round(rev * 100) / 100 : 0;
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

  if (asCsv) {
    const header = 'Office,Customer,FR ID,First Day,Last Day,Days,Tech-Days,Unique Techs,Insulation Revenue,Revenue per Tech,Direct Labor Cost,Direct Labor %';
    const lines = rows.map(r => [r.office, r.customer, r.customerID, r.firstDay, r.lastDay, r.days, r.techDays, r.uniqueTechs, r.insulationRevenue, r.revenuePerTech, '', '']
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    return new NextResponse([header, ...lines].join('\n'), {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="insulation-revenue-${period}-${fmt(start)}.csv"` },
    });
  }

  return NextResponse.json({ period, periodLabel: label, start: fmt(start), end: fmt(end), offices, totals, rows });
}
