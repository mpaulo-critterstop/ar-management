// Exclusion Revenue by Field Professional.
// For a date range (default Aug 1 – today), across all offices:
//   • Find Exclusion appointments (service type 553) in the window.
//   • Crew per work day = route additionalTechs + assignedTech (same crew logic as insulation-revenue).
//   • Exclusion revenue for a job = the exclusion ticket TOTAL (serviceID 553), per Chisam: exclusion line
//     items ONLY — trapping (720) and fogging (510) are EXCLUDED from exclusion revenue and pulled separately.
//   • Aggregate by Field Professional: each FP on a job's crew is credited. Revenue is split across the crew
//     (revenue / crewSize per day) so a 2-person day doesn't double-count; tech-days tracked for $/tech-day.
//
// Also pulls, separately (not mixed into exclusion revenue): Trapping (720) revenue and Fogging (510) revenue
// by FP, so Chisam can analyze revenue per trap check across job types.
//
//   /api/cron/exclusion-revenue?token=critterstop2026                          (Aug 1 → today, all offices)
//   /api/cron/exclusion-revenue?token=critterstop2026&from=2026-08-01&to=2026-10-31
//   /api/cron/exclusion-revenue?token=critterstop2026&office=DFW&csv=1
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

// Service types (confirmed from FR serviceType/get):
const EXCLUSION_TYPE = 553; // "Exclusion" — the revenue we benchmark
const TRAPPING_TYPE  = 720; // "Trapping" — pulled separately
const FOGGING_TYPE   = 510; // "Fogging"  — pulled separately

// Rate-limited FR caller (same proven pattern as insulation-revenue: ~43/min, retry on throttle).
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
        if (msg.includes('limit') || msg.includes('too many') || msg.includes('throttle')) {
          await new Promise(x => setTimeout(x, 8000 * (attempt + 1))); continue;
        }
        return j;
      } catch { await new Promise(x => setTimeout(x, 2000 * (attempt + 1))); }
    }
    return {};
  });
  chain = run.catch(() => ({}));
  return run;
}
const fmt = (d: Date) => d.toISOString().split('T')[0];

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

// Customer's invoice externalIDs from the Hub DB (reliable for old invoices).
async function customerTicketIds(custExtId: string): Promise<string[]> {
  const invs = await prisma.invoice.findMany({
    where: { customer: { externalId: custExtId }, externalId: { not: null } },
    select: { externalId: true },
  });
  return invs.map(i => i.externalId!).filter(Boolean);
}

type FPAgg = {
  frId: string; name: string; office: string;
  exclusionRevenue: number; exclusionTechDays: number; exclusionJobs: Set<string>;
  trappingRevenue: number; foggingRevenue: number;
};

async function runReport(start: Date, end: Date, offices: string[]) {
  // Tech ID -> name map (Hub Technician table).
  const techRows = await prisma.technician.findMany({ where: { frEmployeeId: { not: null } }, select: { frEmployeeId: true, name: true, office: true } });
  const techName = new Map<string, string>(techRows.map(t => [String(t.frEmployeeId), t.name]));

  const fps = new Map<string, FPAgg>(); // key frId
  const getFP = (frId: string, office: string): FPAgg => {
    let f = fps.get(frId);
    if (!f) { f = { frId, name: techName.get(frId) || `FR ${frId}`, office, exclusionRevenue: 0, exclusionTechDays: 0, exclusionJobs: new Set(), trappingRevenue: 0, foggingRevenue: 0 }; fps.set(frId, f); }
    return f;
  };

  const perJob: any[] = []; // audit: one row per exclusion job

  for (const officeName of offices) {
    const cfg = OFFICES[officeName]; if (!cfg?.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

    // 1) All appointments in the window for this office (FR ignores type filter, so fetch once, filter after).
    const s = await fr(`${BASE_URL}/appointment/search?officeIDs=${cfg.officeId}&dateStart=${fmt(start)}&dateEnd=${fmt(end)}&${auth}`);
    const apptIds = (s.appointmentIDs || []).map(Number);
    if (!apptIds.length) continue;
    const appts = await fetchByIds('appointment', 'appointmentIDs', apptIds, cfg.key, cfg.token);

    // 2) Crew per route (additionalTechs + assignedTech).
    const routeIds = [...new Set(appts.map((a: any) => String(a.routeID)).filter(x => x && x !== '0'))];
    const routes = routeIds.length ? await fetchByIds('route', 'routeIDs', routeIds, cfg.key, cfg.token) : [];
    const crewByRoute = new Map<string, string[]>();
    for (const r of routes) {
      const crew = (r.additionalTechs ? String(r.additionalTechs).split(',').map((x: string) => x.trim()).filter(Boolean) : []);
      if (r.assignedTech && String(r.assignedTech) !== '0') crew.push(String(r.assignedTech));
      crewByRoute.set(String(r.routeID), [...new Set(crew)]);
    }

    // 3) Group completed EXCLUSION (553) appts into jobs per customer; track crew-days.
    type Job = { customerID: string; customer: string; firstDay: string; lastDay: string; days: number;
                 crewDays: { date: string; crew: string[] }[]; };
    const jobs = new Map<string, Job>();
    for (const a of appts) {
      const typeId = parseInt(String(a.type || a.serviceTypeID || '0'));
      if (typeId !== EXCLUSION_TYPE) continue;
      if (String(a.status) !== '1') continue; // completed only
      const custID = String(a.customerID); if (!custID || custID === '0') continue;
      const date = String(a.date || a.dateAdded).slice(0, 10);
      const crew = crewByRoute.get(String(a.routeID)) || [];
      let job = jobs.get(custID);
      if (!job) { job = { customerID: custID, customer: a.customerName || custID, firstDay: date, lastDay: date, days: 0, crewDays: [] }; jobs.set(custID, job); }
      job.days += 1; job.crewDays.push({ date, crew });
      if (date < job.firstDay) job.firstDay = date;
      if (date > job.lastDay) job.lastDay = date;
    }

    // 4) Per job: exclusion revenue = sum of the customer's EXCLUSION (553) ticket totals in the window.
    //    Trapping (720) + Fogging (510) summed separately for the same customer.
    for (const job of jobs.values()) {
      const tIds = await customerTicketIds(job.customerID);
      let exclRev = 0, trapRev = 0, fogRev = 0;
      if (tIds.length) {
        const tickets = await fetchByIds('ticket', 'ticketIDs', tIds, cfg.key, cfg.token);
        for (const t of tickets) {
          const svcId = parseInt(String(t.serviceID));
          const tDate = String(t.dateCreated || t.invoiceDate || t.date || '').slice(0, 10);
          // Only count tickets within the window (a customer may have older/newer tickets too).
          if (tDate && (tDate < fmt(start) || tDate > fmt(end))) continue;
          const total = parseFloat(t.total || '0');
          if (svcId === EXCLUSION_TYPE) exclRev += total;
          else if (svcId === TRAPPING_TYPE) trapRev += total;
          else if (svcId === FOGGING_TYPE) fogRev += total;
        }
      }
      exclRev = Math.round(exclRev * 100) / 100;
      trapRev = Math.round(trapRev * 100) / 100;
      fogRev = Math.round(fogRev * 100) / 100;

      // 5) Attribute to FPs. Revenue split evenly across each day's crew, summed over the job's days, so a
      //    multi-tech day credits each tech a share (not the whole amount). Tech-days counted per crew-day.
      //    Revenue is apportioned by each FP's share of total crew-days on the job.
      const totalCrewDaySlots = job.crewDays.reduce((s, cd) => s + Math.max(cd.crew.length, 0), 0);
      const fpDayCount = new Map<string, number>();
      for (const cd of job.crewDays) for (const tech of cd.crew) fpDayCount.set(tech, (fpDayCount.get(tech) || 0) + 1);
      for (const [tech, dayCount] of fpDayCount) {
        const fp = getFP(tech, officeName);
        const share = totalCrewDaySlots > 0 ? dayCount / totalCrewDaySlots : 0;
        fp.exclusionRevenue += exclRev * share;
        fp.trappingRevenue += trapRev * share;
        fp.foggingRevenue += fogRev * share;
        fp.exclusionTechDays += dayCount;
        fp.exclusionJobs.add(job.customerID);
      }
      perJob.push({ office: officeName, customerID: job.customerID, customer: job.customer, firstDay: job.firstDay, lastDay: job.lastDay, days: job.days,
        crew: [...fpDayCount.keys()].map(id => techName.get(id) || `FR ${id}`), exclusionRevenue: exclRev, trappingRevenue: trapRev, foggingRevenue: fogRev });
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
    fieldProfessionals: rows.length,
    totalExclusionRevenue: Math.round(rows.reduce((s, r) => s + r.exclusionRevenue, 0) * 100) / 100,
    totalExclusionTechDays: rows.reduce((s, r) => s + r.exclusionTechDays, 0),
    totalTrappingRevenue: Math.round(rows.reduce((s, r) => s + r.trappingRevenue, 0) * 100) / 100,
    totalFoggingRevenue: Math.round(rows.reduce((s, r) => s + r.foggingRevenue, 0) * 100) / 100,
    exclusionJobs: perJob.length,
  };

  return { rows, totals, perJob };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const from = sp.get('from') || '2026-08-01';
  const to = sp.get('to') || fmt(new Date());
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  const office = sp.get('office');
  const offices = office ? [office] : Object.keys(OFFICES);

  const { rows, totals, perJob } = await runReport(start, end, offices);

  if (sp.get('csv') === '1') {
    const header = 'Field Professional,Office,Exclusion Jobs,Exclusion Tech-Days,Exclusion Revenue,Revenue per Tech-Day,Trapping Revenue,Fogging Revenue';
    const lines = rows.map(r => [r.fieldProfessional, r.office, r.exclusionJobs, r.exclusionTechDays, r.exclusionRevenue, r.revenuePerTechDay, r.trappingRevenue, r.foggingRevenue].join(','));
    return new NextResponse([header, ...lines].join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="exclusion_revenue_${from}_${to}.csv"` } });
  }

  return NextResponse.json({ from, to, offices, note: 'Exclusion revenue = service type 553 ticket totals (exclusion line items only; trapping 720 + fogging 510 pulled separately). Revenue split across crew by tech-day share.', totals, rows, perJob: sp.get('detail') === '1' ? perJob : perJob.slice(0, 50) });
}
