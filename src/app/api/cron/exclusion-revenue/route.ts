// Exclusion Revenue by Field Professional.
// Revenue comes from the Hub `invoice` table (serviceId + amount) — ZERO FR calls for revenue.
//   • Exclusion revenue  = invoices with serviceId 553 (exclusion line items only, per Chisam).
//   • Trapping (720) + Fogging (510) revenue pulled SEPARATELY (not mixed into exclusion).
// Crew attribution comes from FR appointments + routes (the only FR calls): for each exclusion customer,
// which Field Professionals worked the job (route additionalTechs + assignedTech). Revenue is split across
// the crew by tech-day share so a multi-tech job doesn't double-count.
//
// To avoid Vercel timeouts, compute runs in the BACKGROUND (waitUntil) and caches to app_settings; the
// default GET returns the cached result instantly.
//   /api/cron/exclusion-revenue?token=critterstop2026&refresh=1        -> compute (background), all offices
//   /api/cron/exclusion-revenue?token=critterstop2026                  -> read cached result (instant)
//   /api/cron/exclusion-revenue?token=critterstop2026&refresh=1&office=DFW&from=2026-08-01&to=2026-10-31
//   /api/cron/exclusion-revenue?token=critterstop2026&csv=1            -> cached result as CSV
//   /api/cron/exclusion-revenue?token=critterstop2026&status=1         -> compute progress
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
const EXCLUSION_TYPE = 553, TRAPPING_TYPE = 720, FOGGING_TYPE = 510;
const fmt = (d: Date) => d.toISOString().split('T')[0];

let chain: Promise<any> = Promise.resolve();
function fr(url: string): Promise<any> {
  const run = chain.then(async () => {
    await new Promise(r => setTimeout(r, 1400));
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await fetch(url);
        if (r.status === 429) { await new Promise(x => setTimeout(x, 8000 * (attempt + 1))); continue; }
        const j = await r.json();
        const msg = String(j?.errorMessage || '').toLowerCase();
        if (msg.includes('limit') || msg.includes('too many') || msg.includes('throttle')) { await new Promise(x => setTimeout(x, 8000 * (attempt + 1))); continue; }
        return j;
      } catch { await new Promise(x => setTimeout(x, 2000 * (attempt + 1))); }
    }
    return {};
  });
  chain = run.catch(() => ({}));
  return run;
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

async function runReport(from: string, to: string, offices: string[], setStatus: (m: string) => void) {
  const start = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T23:59:59Z');
  const techRows = await prisma.technician.findMany({ where: { frEmployeeId: { not: null } }, select: { frEmployeeId: true, name: true } });
  const techName = new Map<string, string>(techRows.map(t => [String(t.frEmployeeId), t.name]));

  type FPAgg = { frId: string; name: string; office: string; exclusionRevenue: number; exclusionTechDays: number; exclusionJobs: Set<string>; trappingRevenue: number; foggingRevenue: number; };
  const fps = new Map<string, FPAgg>();
  const getFP = (frId: string, office: string): FPAgg => {
    let f = fps.get(frId);
    if (!f) { f = { frId, name: techName.get(frId) || `FR ${frId}`, office, exclusionRevenue: 0, exclusionTechDays: 0, exclusionJobs: new Set(), trappingRevenue: 0, foggingRevenue: 0 }; fps.set(frId, f); }
    return f;
  };
  const perJob: any[] = [];

  for (const officeName of offices) {
    const cfg = OFFICES[officeName]; if (!cfg?.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    setStatus(`${officeName}: loading invoices from Hub…`);

    // 1) Revenue straight from the Hub invoice table (no FR). Group by customer.
    const invs = await prisma.invoice.findMany({
      where: { office: officeName, date: { gte: start, lte: end }, serviceId: { in: [EXCLUSION_TYPE, TRAPPING_TYPE, FOGGING_TYPE] } },
      select: { customerId: true, serviceId: true, amount: true, customer: { select: { externalId: true, name: true } } },
    });
    const revByCust = new Map<string, { excl: number; trap: number; fog: number; name: string; extId: string }>();
    for (const inv of invs) {
      const extId = inv.customer?.externalId; if (!extId) continue;
      let r = revByCust.get(extId); if (!r) { r = { excl: 0, trap: 0, fog: 0, name: inv.customer?.name || extId, extId }; revByCust.set(extId, r); }
      const amt = Number(inv.amount);
      if (inv.serviceId === EXCLUSION_TYPE) r.excl += amt; else if (inv.serviceId === TRAPPING_TYPE) r.trap += amt; else if (inv.serviceId === FOGGING_TYPE) r.fog += amt;
    }
    // Only customers that actually have exclusion revenue drive FP attribution (trapping/fogging-only customers
    // still contribute their revenue, but attribution is based on exclusion work days).
    const exclCustIds = [...revByCust.entries()].filter(([, r]) => r.excl > 0).map(([id]) => id);
    setStatus(`${officeName}: ${revByCust.size} customers w/ revenue, ${exclCustIds.length} w/ exclusion. Loading crew from FR…`);
    if (!revByCust.size) continue;

    // 2) Crew from FR: exclusion appointments in the window + their routes. One appt search for the window.
    const s = await fr(`${BASE_URL}/appointment/search?officeIDs=${cfg.officeId}&dateStart=${from}&dateEnd=${to}&${auth}`);
    const apptIds = (s.appointmentIDs || []).map(Number);
    const appts = apptIds.length ? await fetchByIds('appointment', 'appointmentIDs', apptIds, cfg.key, cfg.token) : [];
    const routeIds = [...new Set(appts.filter((a: any) => parseInt(String(a.type)) === EXCLUSION_TYPE).map((a: any) => String(a.routeID)).filter(x => x && x !== '0'))];
    const routes = routeIds.length ? await fetchByIds('route', 'routeIDs', routeIds, cfg.key, cfg.token) : [];
    const crewByRoute = new Map<string, string[]>();
    for (const r of routes) {
      const crew = (r.additionalTechs ? String(r.additionalTechs).split(',').map((x: string) => x.trim()).filter(Boolean) : []);
      if (r.assignedTech && String(r.assignedTech) !== '0') crew.push(String(r.assignedTech));
      crewByRoute.set(String(r.routeID), [...new Set(crew)]);
    }
    // Per customer, collect completed exclusion appt crew-days.
    const custCrewDays = new Map<string, string[][]>();
    for (const a of appts) {
      if (parseInt(String(a.type)) !== EXCLUSION_TYPE || String(a.status) !== '1') continue;
      const custID = String(a.customerID); if (!custID || custID === '0') continue;
      const crew = crewByRoute.get(String(a.routeID)) || [];
      (custCrewDays.get(custID) || custCrewDays.set(custID, []).get(custID)!).push(crew);
    }

    // 3) Attribute each customer's revenue to the FPs who worked their exclusion days (split by tech-day share).
    for (const [extId, rev] of revByCust) {
      const crewDays = custCrewDays.get(extId) || [];
      const fpDayCount = new Map<string, number>();
      for (const crew of crewDays) for (const tech of crew) fpDayCount.set(tech, (fpDayCount.get(tech) || 0) + 1);
      const totalSlots = [...fpDayCount.values()].reduce((s, n) => s + n, 0);
      if (totalSlots === 0) {
        // Revenue exists but no crew matched (e.g. trapping/fogging-only, or appt crew missing) -> unattributed bucket.
        const fp = getFP('UNATTRIBUTED', officeName);
        fp.exclusionRevenue += rev.excl; fp.trappingRevenue += rev.trap; fp.foggingRevenue += rev.fog;
        perJob.push({ office: officeName, customerID: extId, customer: rev.name, crew: [], exclusionRevenue: Math.round(rev.excl * 100) / 100, trappingRevenue: Math.round(rev.trap * 100) / 100, foggingRevenue: Math.round(rev.fog * 100) / 100, note: 'no crew matched' });
        continue;
      }
      for (const [tech, dayCount] of fpDayCount) {
        const fp = getFP(tech, officeName);
        const share = dayCount / totalSlots;
        fp.exclusionRevenue += rev.excl * share; fp.trappingRevenue += rev.trap * share; fp.foggingRevenue += rev.fog * share;
        fp.exclusionTechDays += dayCount; fp.exclusionJobs.add(extId);
      }
      perJob.push({ office: officeName, customerID: extId, customer: rev.name, crew: [...fpDayCount.keys()].map(id => techName.get(id) || `FR ${id}`), exclusionRevenue: Math.round(rev.excl * 100) / 100, trappingRevenue: Math.round(rev.trap * 100) / 100, foggingRevenue: Math.round(rev.fog * 100) / 100 });
    }
  }

  const rows = [...fps.values()].map(f => ({
    fieldProfessional: f.name, frId: f.frId, office: f.office,
    exclusionJobs: f.exclusionJobs.size, exclusionTechDays: f.exclusionTechDays,
    exclusionRevenue: Math.round(f.exclusionRevenue * 100) / 100,
    revenuePerTechDay: f.exclusionTechDays > 0 ? Math.round((f.exclusionRevenue / f.exclusionTechDays) * 100) / 100 : 0,
    trappingRevenue: Math.round(f.trappingRevenue * 100) / 100,
    foggingRevenue: Math.round(f.foggingRevenue * 100) / 100,
  })).sort((a, b) => b.exclusionRevenue - a.exclusionRevenue);
  const totals = {
    fieldProfessionals: rows.filter(r => r.frId !== 'UNATTRIBUTED').length,
    totalExclusionRevenue: Math.round(rows.reduce((s, r) => s + r.exclusionRevenue, 0) * 100) / 100,
    totalExclusionTechDays: rows.reduce((s, r) => s + r.exclusionTechDays, 0),
    totalTrappingRevenue: Math.round(rows.reduce((s, r) => s + r.trappingRevenue, 0) * 100) / 100,
    totalFoggingRevenue: Math.round(rows.reduce((s, r) => s + r.foggingRevenue, 0) * 100) / 100,
    exclusionJobs: perJob.length,
  };
  return { rows, totals, perJob };
}

const CACHE_KEY = 'exclusion_revenue_cache';
const STATUS_KEY = 'exclusion_revenue_status';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (sp.get('status') === '1') {
    const st = await prisma.appSetting.findUnique({ where: { key: STATUS_KEY } });
    return NextResponse.json({ status: st?.value || 'idle' });
  }

  const from = sp.get('from') || '2026-08-01';
  const to = sp.get('to') || fmt(new Date());
  const office = sp.get('office');
  const offices = office ? [office] : Object.keys(OFFICES);

  if (sp.get('refresh') === '1') {
    const setStatus = (m: string) => { prisma.appSetting.upsert({ where: { key: STATUS_KEY }, create: { key: STATUS_KEY, value: m }, update: { value: m } }).catch(() => {}); };
    setStatus(`started ${from}→${to} offices=${offices.join(',')}`);
    waitUntil((async () => {
      try {
        const data = await runReport(from, to, offices, setStatus);
        await prisma.appSetting.upsert({ where: { key: CACHE_KEY }, create: { key: CACHE_KEY, value: JSON.stringify({ from, to, offices, computedAt: new Date().toISOString(), ...data }) }, update: { value: JSON.stringify({ from, to, offices, computedAt: new Date().toISOString(), ...data }) } });
        setStatus(`done ${from}→${to} — ${data.rows.length} FPs, ${data.totals.exclusionJobs} jobs, $${data.totals.totalExclusionRevenue.toLocaleString()} exclusion rev @ ${new Date().toISOString()}`);
      } catch (e: any) { setStatus(`ERROR: ${String(e).slice(0, 200)}`); }
    })());
    return NextResponse.json({ ok: true, started: true, from, to, offices, note: 'Computing in background. Check &status=1 for progress, then reload without refresh to see results (a few minutes).' });
  }

  // Default: read cached result.
  const cached = await prisma.appSetting.findUnique({ where: { key: CACHE_KEY } });
  if (!cached) return NextResponse.json({ note: 'Not computed yet — run with &refresh=1, then check &status=1.', totals: null, rows: [] });
  const data = JSON.parse(cached.value);

  if (sp.get('csv') === '1') {
    const header = 'Field Professional,Office,Exclusion Jobs,Exclusion Tech-Days,Exclusion Revenue,Revenue per Tech-Day,Trapping Revenue,Fogging Revenue';
    const lines = (data.rows || []).map((r: any) => [r.fieldProfessional, r.office, r.exclusionJobs, r.exclusionTechDays, r.exclusionRevenue, r.revenuePerTechDay, r.trappingRevenue, r.foggingRevenue].join(','));
    return new NextResponse([header, ...lines].join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="exclusion_revenue_${data.from}_${data.to}.csv"` } });
  }
  return NextResponse.json({ from: data.from, to: data.to, offices: data.offices, computedAt: data.computedAt, totals: data.totals, rows: data.rows, perJob: sp.get('detail') === '1' ? data.perJob : (data.perJob || []).slice(0, 50) });
}
