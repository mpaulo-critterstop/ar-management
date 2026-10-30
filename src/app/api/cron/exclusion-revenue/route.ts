// Exclusion Revenue by Field Professional.
//
// Model (confirmed with Mark):
//   • COMPLETED exclusion appointments drive the report (type 553, status=1) in the window. This naturally
//     excludes invoiced-but-not-yet-serviced jobs.
//   • Crew per visit = route/appointment assignedTech + additionalTechs.
//   • Scheduled hours per job = sum of the job's exclusion appointment durations (the booked time block,
//     e.g. 7am–12pm = 5 hrs). Actual timeIn/timeOut is NOT used (only tracks the main tech; unreliable).
//   • Exclusion revenue per job = exclusion ticket TOTAL − ALL product line items (i.e. the base service
//     charge). Every line item (Trapping 8, Fogging 9, Insulation 10/43, Rodent Cleanout 16, anything else)
//     is an add-on and is excluded — only the exclusion base charge counts as exclusion revenue.
//   • Trapping/Fogging revenue pulled separately (products 8 / 9) for Chisam's trap-check analysis.
//   • Key metric: $ per scheduled tech-hour = exclusion revenue / (scheduled hours × crew size). This is what
//     we measure against the standard ($225/hr easy / $175/hr hard) once story/difficulty tags are available.
//
// Background compute (waitUntil) + cache to app_settings to avoid Vercel timeouts.
//   ?token=critterstop2026&refresh=1[&office=DFW][&from=2026-08-01][&to=2026-10-31]   -> compute
//   ?token=critterstop2026                                                            -> cached result
//   ?token=critterstop2026&status=1   ?token=...&csv=1   ?token=...&detail=1
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
const EXCLUSION_TYPE = 553;
const TRAPPING_PRODUCT = 8, FOGGING_PRODUCT = 9;
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
async function fetchByIds(entity: string, idParamName: string, ids: any[], key: string, token: string, extra = ''): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const d = await fr(`${BASE_URL}/${entity}/get?${idParamName}=${idParam}&authenticationKey=${key}&authenticationToken=${token}${extra}`);
    const prop = d.propertyName || `${entity}s`;
    if (Array.isArray(d[prop])) out.push(...d[prop]);
  }
  return out;
}

// Productivity standard: a tech on a 10hr/day should generate this much exclusion revenue per hour.
const RATE_1STORY = 225; // easy / 1-story
const RATE_2STORY = 175; // harder / 2-story

async function runReport(from: string, to: string, offices: string[], setStatus: (m: string) => void) {
  const techRows = await prisma.technician.findMany({ where: { frEmployeeId: { not: null } }, select: { frEmployeeId: true, name: true } });
  const techName = new Map<string, string>(techRows.map(t => [String(t.frEmployeeId), t.name]));

  // Attendance-based phantom-crew cleanup: drop crew members who are TRACKED in attendance but were NOT present
  // on the job's date (no clock-in / no attendance row) — the additional-tech-for-access / un-removed call-out
  // data error. present = set of "techname|date" that actually worked; tracked = techs we have attendance for.
  const normName = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
  const attRow = await prisma.appSetting.findUnique({ where: { key: 'excl_attendance_present' } });
  const attData = attRow ? JSON.parse(attRow.value) : { present: [], tracked: [] };
  const presentSet = new Set<string>(attData.present || []);
  const trackedSet = new Set<string>((attData.tracked || []).map((n: string) => normName(n)));
  // Returns true if this FR tech id should be DROPPED for this date (tracked but not present = phantom).
  const isPhantom = (frId: string, date: string) => {
    const nm = normName(techName.get(String(frId)) || '');
    if (!nm || !trackedSet.has(nm)) return false;      // not a tracked tech -> can't verify -> keep
    return !presentSet.has(`${nm}|${date}`);            // tracked but not present that day -> phantom
  };

  // Story-count map (FR customerID -> 1 or 2), loaded from the imported Exclusions sheet.
  const storiesRow = await prisma.appSetting.findUnique({ where: { key: 'exclusion_stories_map' } });
  const storiesMap: Record<string, number> = storiesRow ? JSON.parse(storiesRow.value) : {};
  const rateFor = (cid: string): number | null => { const s = storiesMap[String(cid)]; return s === 1 ? RATE_1STORY : s === 2 ? RATE_2STORY : null; };

  // Customer name map (FR externalId -> name) from the Hub, so job detail shows names not IDs.
  const custRows = await prisma.customer.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true, name: true } });
  const custName = new Map<string, string>(custRows.map(c => [String(c.externalId), c.name]));
  const custInternalIdToExt = new Map<string, string>(custRows.map(c => [c.id, String(c.externalId)]));

  // PM per customer — referenced from the Leads Tracker (Lead.pmName, keyed to internal customerId). Map to
  // FR externalId so we can attach the PM to each exclusion job. (PM = the scheduler whose scheduling we measure.)
  const leadRows = await prisma.lead.findMany({ where: { pmName: { not: null } }, select: { customerId: true, pmName: true, inspectionDate: true } });
  const pmByExtId = new Map<string, string>();
  for (const l of leadRows) {
    const ext = custInternalIdToExt.get(l.customerId); if (!ext) continue;
    // keep the most recent lead's PM if a customer has several
    if (!pmByExtId.has(ext)) pmByExtId.set(ext, l.pmName!);
  }

  type FPAgg = { frId: string; name: string; office: string; exclusionRevenue: number; schedHours: number; techHours: number; expectedHours: number; jobs: Set<string>; trappingRevenue: number; foggingRevenue: number; };
  const fps = new Map<string, FPAgg>();
  const getFP = (frId: string, office: string): FPAgg => {
    let f = fps.get(frId);
    if (!f) { f = { frId, name: techName.get(frId) || `FR ${frId}`, office, exclusionRevenue: 0, schedHours: 0, techHours: 0, expectedHours: 0, jobs: new Set(), trappingRevenue: 0, foggingRevenue: 0 }; fps.set(frId, f); }
    return f;
  };
  const perJob: any[] = [];

  for (const officeName of offices) {
    const cfg = OFFICES[officeName]; if (!cfg?.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    setStatus(`${officeName}: searching appointments…`);

    // 1) Completed exclusion appointments in window (FR ignores type filter — fetch window, filter to 553/status=1).
    const s = await fr(`${BASE_URL}/appointment/search?officeIDs=${cfg.officeId}&dateStart=${from}&dateEnd=${to}&${auth}`);
    const apptIds = (s.appointmentIDs || []).map(Number);
    if (!apptIds.length) { setStatus(`${officeName}: no appts`); continue; }
    const appts = await fetchByIds('appointment', 'appointmentIDs', apptIds, cfg.key, cfg.token);
    const exclAppts = appts.filter((a: any) => parseInt(String(a.type)) === EXCLUSION_TYPE && String(a.status) === '1');
    setStatus(`${officeName}: ${exclAppts.length} completed exclusion appts. Fetching routes for crew…`);

    // 2a) CREW LIVES ON THE ROUTE, not the appointment (appt.additionalTechs is always null). Fetch the routes
    //     of these exclusion appts and read route.additionalTechs + route.assignedTech. (This was the bug Chisam
    //     caught — additional techs weren't being captured because we read them off the appointment.)
    const routeIds = [...new Set(exclAppts.map((a: any) => String(a.routeID)).filter(r => r && r !== '0'))];
    const routes = routeIds.length ? await fetchByIds('route', 'routeIDs', routeIds, cfg.key, cfg.token) : [];
    const crewByRoute = new Map<string, string[]>();
    for (const r of routes) {
      const crew = (r.additionalTechs ? String(r.additionalTechs).split(',').map((x: string) => x.trim()).filter(Boolean) : []);
      if (r.assignedTech && String(r.assignedTech) !== '0') crew.push(String(r.assignedTech));
      crewByRoute.set(String(r.routeID), [...new Set(crew)]);
    }

    // Per-route BLOCKED-SPOT count + appointment count, for the Option B duration rule (480-min cap workaround).
    // FR hard-caps appointment duration at 480 (8hr) but techs work 10hr/4. True reserved time is recovered via:
    //   • blocked spots (deliberately set to reserve overflow): true = 480 + blockedSpots×30  [going forward]
    //   • else solo-exclusion route (no other appts): assume 600 (10hr)                         [historical]
    //   • else shared route: 480 as-is
    // Appointment count per route — derived from the office-wide appts we ALREADY fetched (no extra calls).
    const apptCountByRoute = new Map<string, number>();
    for (const a of appts) { const rid = String(a.routeID); if (rid && rid !== '0') apptCountByRoute.set(rid, (apptCountByRoute.get(rid) || 0) + 1); }
    // Blocked-spot minutes per route. Only routes with a 480-capped exclusion matter. BATCHED: search
    // blocked-only spots (blockReason=Blocked) for those routes in chunks, fetch them, tally 30 min each by route.
    const blockedMinByRoute = new Map<string, number>();
    const routesNeedingSpots = [...new Set(exclAppts
      .filter((a: any) => (parseInt(String(a.duration || '0')) || 0) >= 480)
      .map((a: any) => String(a.routeID)).filter(r => r && r !== '0'))];
    for (let i = 0; i < routesNeedingSpots.length; i += 50) {
      const chunk = routesNeedingSpots.slice(i, i + 50);
      const ss = await fr(`${BASE_URL}/spot/search?routeIDs=${chunk.join(',')}&blockReason=Blocked&${auth}`);
      const spotIds = ss.spotIDs || [];
      if (!spotIds.length) continue;
      const spots = await fetchByIds('spot', 'spotIDs', spotIds, cfg.key, cfg.token);
      for (const sp of spots) {
        const br = sp.blockReason; if (!br || String(br) === '0' || br === 0) continue;
        const rid = String(sp.routeID);
        blockedMinByRoute.set(rid, (blockedMinByRoute.get(rid) || 0) + 30);
      }
    }
    // Resolve the true scheduled minutes for one exclusion appointment per Option B.
    const trueMinutes = (a: any): number => {
      const dur = parseInt(String(a.duration || '0')) || 0;
      if (dur < 480) return dur; // under the cap — accurate as-is
      const rid = String(a.routeID);
      const blocked = blockedMinByRoute.get(rid) || 0;
      if (blocked > 0) return 480 + blocked;                        // precise: blocked spots present (going forward)
      if ((apptCountByRoute.get(rid) || 0) <= 1) return 600;        // historical: solo-exclusion route -> assume 10hr
      return 480;                                                   // historical: shared route -> as-is
    };

    // 2b) Group appts into jobs per customer; collect crew-days + scheduled durations + ticketIDs.
    type Job = { customerID: string; customer: string; firstDay: string; lastDay: string; schedMinutes: number;
                 crewDays: string[][]; dayLegs: { minutes: number; crew: string[] }[]; ticketIds: Set<string>; };
    const jobs = new Map<string, Job>();
    for (const a of exclAppts) {
      const custID = String(a.customerID); if (!custID || custID === '0') continue;
      const date = String(a.date || a.dateAdded).slice(0, 10);
      // Crew from the route; fall back to the appointment's own tech if the route had none.
      let crew = [...(crewByRoute.get(String(a.routeID)) || [])];
      if (!crew.length) {
        if (a.assignedTech && String(a.assignedTech) !== '0') crew.push(String(a.assignedTech));
        else if (a.servicedBy && String(a.servicedBy) !== '0') crew.push(String(a.servicedBy));
      }
      let uniqCrew = [...new Set(crew)];
      // Phantom-crew cleanup: remove tracked techs who weren't present this date (keeps at least 1 so the job
      // doesn't drop to zero crew if everyone is flagged — conservative).
      // Attendance-based phantom cleanup is applied for DFW only — that's where attendance coverage is reliable.
      // Other offices (ATX/OKC/CStat) are left as-is to avoid name-matching / crew-read uncertainty.
      if (officeName === 'DFW') {
        const cleanedCrew = uniqCrew.filter(t => !isPhantom(t, date));
        if (cleanedCrew.length > 0 && cleanedCrew.length < uniqCrew.length) uniqCrew = cleanedCrew;
      }
      let job = jobs.get(custID);
      if (!job) { job = { customerID: custID, customer: a.customerName || custID, firstDay: date, lastDay: date, schedMinutes: 0, crewDays: [], dayLegs: [], ticketIds: new Set() }; jobs.set(custID, job); }
      const legMinutes = trueMinutes(a); // Option B: uncaps 480 via blocked spots / solo-route assumption
      job.schedMinutes += legMinutes;
      job.crewDays.push(uniqCrew);
      job.dayLegs.push({ minutes: legMinutes, crew: uniqCrew }); // per-day leg: this day's duration + this day's crew
      if (a.ticketID && String(a.ticketID) !== '0') job.ticketIds.add(String(a.ticketID));
      if (date < job.firstDay) job.firstDay = date;
      if (date > job.lastDay) job.lastDay = date;
    }
    setStatus(`${officeName}: ${jobs.size} exclusion jobs. Resolving revenue tickets…`);

    // 3) Revenue is NOT on the appointment's service ticket (that's $0) — it's on the customer's 553 REVENUE
    //    ticket (the sale/invoice with the base charge + line items). Get each exclusion customer's invoice
    //    externalIds from the Hub DB, then batch-fetch those tickets (100/call) and keep the 553 ones.
    const custIds = [...jobs.keys()];
    const invRows = await prisma.invoice.findMany({
      where: { customer: { externalId: { in: custIds } }, externalId: { not: null } },
      select: { externalId: true, customer: { select: { externalId: true } } },
    });
    const ticketIdsByCust = new Map<string, string[]>();
    for (const inv of invRows) {
      const c = inv.customer?.externalId; if (!c || !inv.externalId) continue;
      (ticketIdsByCust.get(c) || ticketIdsByCust.set(c, []).get(c)!).push(inv.externalId);
    }
    const allTicketIds = [...new Set(invRows.map(i => i.externalId!).filter(Boolean))];
    const allTickets = allTicketIds.length ? await fetchByIds('ticket', 'ticketIDs', allTicketIds, cfg.key, cfg.token, '&includeData=1') : [];
    const ticketById = new Map<string, any>(allTickets.map(t => [String(t.ticketID), t]));
    setStatus(`${officeName}: fetched ${allTickets.length} tickets. Computing revenue…`);

    // Per job: find the customer's 553 revenue ticket(s) (total>0), exclusion revenue = total − all line items.
    for (const job of jobs.values()) {
      let exclRev = 0, trapRev = 0, fogRev = 0;
      const custTicketIds = ticketIdsByCust.get(job.customerID) || [];
      for (const tid of custTicketIds) {
        const t = ticketById.get(String(tid)); if (!t) continue;
        if (parseInt(String(t.serviceID)) !== EXCLUSION_TYPE) continue; // only 553 revenue tickets
        const total = parseFloat(t.total || '0');
        if (total <= 0) continue; // skip the $0 service-visit ticket
        const items = t.items || [];
        // Exclusion revenue = FR's serviceCharge — the pre-tax base service charge (non-taxable), which excludes
        // ALL product line items (trapping/fogging/FAR) AND their tax. Using total−items wrongly kept the tax
        // on taxable add-ons inside exclusion (e.g. cust 49666: serviceCharge $1,538, not $1,618.80).
        exclRev += parseFloat(t.serviceCharge || '0');
        for (const it of items) {
          const pid = parseInt(String(it.productID));
          if (pid === TRAPPING_PRODUCT) trapRev += parseFloat(it.amount || '0');
          else if (pid === FOGGING_PRODUCT) fogRev += parseFloat(it.amount || '0');
        }
      }
      exclRev = Math.round(exclRev * 100) / 100; trapRev = Math.round(trapRev * 100) / 100; fogRev = Math.round(fogRev * 100) / 100;
      const schedHours = Math.round((job.schedMinutes / 60) * 100) / 100;

      // 4) Attribute to FPs by tech-day share. Each appt-day contributes its crew; a tech's share = their
      //    crew-day count / total crew-day slots on the job.
      const fpDayCount = new Map<string, number>();
      for (const crew of job.crewDays) for (const tech of crew) fpDayCount.set(tech, (fpDayCount.get(tech) || 0) + 1);
      const totalSlots = [...fpDayCount.values()].reduce((s, n) => s + n, 0);
      // Total tech-hours on the job = scheduled hours × (sum of crew sizes per day / number of days) — but
      // simpler and exact: tech-hours = Σ over days (dayDuration × dayCrewSize). Since we summed schedMinutes
      // across days, approximate per-FP hours = schedHours × (their day share). Good enough at job grain.
      // Stories → rate → expected tech-hours (revenue the job "earns" at standard / rate) → variance.
      const stories = storiesMap[String(job.customerID)] || null;
      const rate = rateFor(job.customerID);
      // Scheduled TECH-hours = Σ over each day (that day's hours × that day's crew size). The old formula
      // (schedHours × distinct-tech-count) double-counted when a tech worked multiple days, e.g. Bryan Livengood:
      // Day1 10h×4 + Day2 10h×3 = 70, NOT 20h × 5-distinct-techs = 100.
      const schedTechMinutes = job.dayLegs.reduce((s, leg) => s + leg.minutes * Math.max(leg.crew.length, 1), 0);
      const schedTechHours = Math.round((schedTechMinutes / 60) * 100) / 100;
      // avg crew size (for display only) — total tech-hours / total hours
      const crewSize = schedHours > 0 ? Math.round((schedTechHours / schedHours) * 100) / 100 : Math.max(fpDayCount.size, 1);
      const expectedTechHours = rate ? Math.round((exclRev / rate) * 100) / 100 : null; // total tech-hours the revenue justifies
      const varianceHours = expectedTechHours !== null ? Math.round((expectedTechHours - schedTechHours) * 100) / 100 : null; // + = under-allotted (should've had more time), - = over-allotted

      // Per-FP on-site hours = Σ of the hours of each DAY this tech actually worked (from dayLegs).
      const techHoursByFp = new Map<string, number>();
      for (const leg of job.dayLegs) { const h = leg.minutes / 60; for (const t of leg.crew) techHoursByFp.set(t, (techHoursByFp.get(t) || 0) + h); }
      for (const [tech, dayCount] of fpDayCount) {
        const fp = getFP(tech, officeName);
        const share = totalSlots > 0 ? dayCount / totalSlots : 0;
        fp.exclusionRevenue += exclRev * share;
        fp.trappingRevenue += trapRev * share;
        fp.foggingRevenue += fogRev * share;
        fp.schedHours += schedHours * share;           // FP's share of the job's scheduled hours
        fp.techHours += techHoursByFp.get(tech) || 0;  // FP hours actually on site (sum of their actual days)
        if (expectedTechHours !== null) fp.expectedHours += expectedTechHours * share; // FP's share of expected
        fp.jobs.add(job.customerID);
      }
      perJob.push({ office: officeName, customerID: job.customerID, customer: custName.get(String(job.customerID)) || job.customer, pm: pmByExtId.get(String(job.customerID)) || 'Unassigned', firstDay: job.firstDay, lastDay: job.lastDay,
        stories, rate, schedHours, crewSize, crew: [...fpDayCount.keys()].map(id => techName.get(id) || `FR ${id}`),
        exclusionRevenue: exclRev, trappingRevenue: trapRev, foggingRevenue: fogRev,
        schedTechHours, expectedTechHours, varianceHours,
        revenuePerSchedTechHour: schedTechHours > 0 ? Math.round((exclRev / schedTechHours) * 100) / 100 : 0 });
    }
  }

  const rows = [...fps.values()].map(f => ({
    fieldProfessional: f.name, frId: f.frId, office: f.office,
    jobs: f.jobs.size,
    exclusionRevenue: Math.round(f.exclusionRevenue * 100) / 100,
    scheduledHours: Math.round(f.techHours * 100) / 100,
    expectedHours: Math.round(f.expectedHours * 100) / 100,
    varianceHours: Math.round((f.expectedHours - f.techHours) * 100) / 100,
    revenuePerSchedTechHour: f.techHours > 0 ? Math.round((f.exclusionRevenue / f.techHours) * 100) / 100 : 0,
    trappingRevenue: Math.round(f.trappingRevenue * 100) / 100,
    foggingRevenue: Math.round(f.foggingRevenue * 100) / 100,
  })).sort((a, b) => b.exclusionRevenue - a.exclusionRevenue);

  const tagged = perJob.filter(j => j.rate !== null);
  const one = perJob.filter(j => j.stories === 1), two = perJob.filter(j => j.stories === 2);
  const sumExpected = tagged.reduce((s, j) => s + (j.expectedTechHours || 0), 0);
  const sumSched = tagged.reduce((s, j) => s + j.schedTechHours, 0);
  const totals = {
    fieldProfessionals: rows.filter(r => r.frId !== 'UNATTRIBUTED').length,
    exclusionJobs: perJob.length,
    totalExclusionRevenue: Math.round(rows.reduce((s, r) => s + r.exclusionRevenue, 0) * 100) / 100,
    totalScheduledTechHours: Math.round(rows.reduce((s, r) => s + r.scheduledHours, 0) * 100) / 100,
    totalTrappingRevenue: Math.round(rows.reduce((s, r) => s + r.trappingRevenue, 0) * 100) / 100,
    totalFoggingRevenue: Math.round(rows.reduce((s, r) => s + r.foggingRevenue, 0) * 100) / 100,
    blendedRevPerSchedTechHour: rows.reduce((s, r) => s + r.scheduledHours, 0) > 0 ? Math.round((rows.reduce((s, r) => s + r.exclusionRevenue, 0) / rows.reduce((s, r) => s + r.scheduledHours, 0)) * 100) / 100 : 0,
    // Stories coverage + the standard-vs-scheduled picture (the blind spot):
    jobsTagged: tagged.length, jobsUntagged: perJob.length - tagged.length,
    oneStoryJobs: one.length, twoStoryJobs: two.length,
    oneStoryBlendedRate: one.reduce((s, j) => s + j.schedTechHours, 0) > 0 ? Math.round((one.reduce((s, j) => s + j.exclusionRevenue, 0) / one.reduce((s, j) => s + j.schedTechHours, 0)) * 100) / 100 : 0,
    twoStoryBlendedRate: two.reduce((s, j) => s + j.schedTechHours, 0) > 0 ? Math.round((two.reduce((s, j) => s + j.exclusionRevenue, 0) / two.reduce((s, j) => s + j.schedTechHours, 0)) * 100) / 100 : 0,
    expectedTechHoursAtStandard: Math.round(sumExpected * 100) / 100,
    scheduledTechHoursTagged: Math.round(sumSched * 100) / 100,
    varianceHours: Math.round((sumExpected - sumSched) * 100) / 100, // + = jobs under-allotted overall; - = over-allotted
  };
  // PM SCHEDULING SCORECARD — measures how consistently each PM schedules tech-hours vs exclusion revenue,
  // and whether they differentiate 1-story vs 2-story. (Chisam: this is about PM scheduling, not tech performance.)
  const pmAgg = new Map<string, { pm: string; jobs: number; revenue: number; schedTechHours: number; expectedTechHours: number;
    oneRev: number; oneHrs: number; oneJobs: number; twoRev: number; twoHrs: number; twoJobs: number; rates: number[] }>();
  for (const j of perJob) {
    const pm = j.pm || 'Unassigned';
    let a = pmAgg.get(pm);
    if (!a) { a = { pm, jobs: 0, revenue: 0, schedTechHours: 0, expectedTechHours: 0, oneRev: 0, oneHrs: 0, oneJobs: 0, twoRev: 0, twoHrs: 0, twoJobs: 0, rates: [] }; pmAgg.set(pm, a); }
    a.jobs++; a.revenue += j.exclusionRevenue; a.schedTechHours += j.schedTechHours || 0; a.expectedTechHours += j.expectedTechHours || 0;
    if (j.schedTechHours > 0) a.rates.push(j.exclusionRevenue / j.schedTechHours);
    if (j.stories === 1) { a.oneRev += j.exclusionRevenue; a.oneHrs += j.schedTechHours || 0; a.oneJobs++; }
    else if (j.stories === 2) { a.twoRev += j.exclusionRevenue; a.twoHrs += j.schedTechHours || 0; a.twoJobs++; }
  }
  const stdev = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.round(Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) * 100) / 100; };
  const byPM = [...pmAgg.values()].map(a => {
    const oneRate = a.oneHrs > 0 ? Math.round((a.oneRev / a.oneHrs) * 100) / 100 : 0;
    const twoRate = a.twoHrs > 0 ? Math.round((a.twoRev / a.twoHrs) * 100) / 100 : 0;
    return {
      pm: a.pm, jobs: a.jobs,
      exclusionRevenue: Math.round(a.revenue * 100) / 100,
      schedTechHours: Math.round(a.schedTechHours * 100) / 100,
      expectedTechHours: Math.round(a.expectedTechHours * 100) / 100,
      varianceHours: Math.round((a.expectedTechHours - a.schedTechHours) * 100) / 100,
      avgRevPerSchedTechHour: a.schedTechHours > 0 ? Math.round((a.revenue / a.schedTechHours) * 100) / 100 : 0,
      ratePerHourStdev: stdev(a.rates), // variance/consistency of their scheduling
      oneStoryJobs: a.oneJobs, oneStoryRate: oneRate,
      twoStoryJobs: a.twoJobs, twoStoryRate: twoRate,
      // Does the PM differentiate? 1-story SHOULD run a higher $/hr (less time) than 2-story. Positive = good differentiation.
      differentiation: (oneRate && twoRate) ? Math.round((oneRate - twoRate) * 100) / 100 : null,
    };
  }).sort((a, b) => b.exclusionRevenue - a.exclusionRevenue);

  return { rows, totals, perJob, byPM };
}

const STATUS_KEY = 'exclusion_revenue_status';
// Cache key per period + periodKey + office, stored in appSetting (no migration).
//   period 'range' (default) -> the full from→to span (Aug 1–today) : key = `${from}_${to}`
//   period 'week'  -> Monday-start week containing `date`          : key = week-start date
//   period 'month' -> calendar month containing `date`             : key = YYYY-MM
function cacheKey(period: string, periodKey: string, office: string) { return `exclrev:${period}:${periodKey}:${office}`; }

// Resolve period -> {from, to, periodKey, label}.
function resolvePeriod(sp: URLSearchParams): { period: string; from: string; to: string; periodKey: string; label: string } {
  const period = sp.get('period') || 'range';
  if (period === 'week') {
    const d = sp.get('date') ? new Date(sp.get('date')! + 'T00:00:00Z') : new Date();
    const dow = d.getUTCDay(); const diff = dow === 0 ? -6 : 1 - dow;
    const start = new Date(d); start.setUTCDate(d.getUTCDate() + diff);
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    const from = fmt(start), to = fmt(end);
    return { period, from, to, periodKey: from, label: `Wk of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` };
  }
  if (period === 'month') {
    const d = sp.get('date') ? new Date(sp.get('date')! + 'T00:00:00Z') : new Date();
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const pk = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    return { period, from: fmt(start), to: fmt(end), periodKey: pk, label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  const from = sp.get('from') || '2026-08-01';
  const to = sp.get('to') || fmt(new Date());
  return { period: 'range', from, to, periodKey: `${from}_${to}`, label: `${from} → ${to}` };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (sp.get('status') === '1') {
    const st = await prisma.appSetting.findUnique({ where: { key: STATUS_KEY } });
    return NextResponse.json({ status: st?.value || 'idle' });
  }

  const { period, from, to, periodKey, label } = resolvePeriod(sp);
  const office = sp.get('office') || 'DFW';
  const offices = [office];
  const CK = cacheKey(period, periodKey, office);


  if (sp.get('refresh') === '1') {
    const setStatus = (m: string) => { prisma.appSetting.upsert({ where: { key: STATUS_KEY }, create: { key: STATUS_KEY, value: m }, update: { value: m } }).catch(() => {}); };
    setStatus(`started ${label} ${office}`);
    waitUntil((async () => {
      try {
        const data = await runReport(from, to, offices, setStatus);
        const payload = JSON.stringify({ period, periodKey, label, from, to, offices, computedAt: new Date().toISOString(), ...data });
        await prisma.appSetting.upsert({ where: { key: CK }, create: { key: CK, value: payload }, update: { value: payload } });
        setStatus(`done ${label} ${office} — ${data.rows.length} FPs, ${data.totals.exclusionJobs} jobs, $${data.totals.totalExclusionRevenue.toLocaleString()} excl rev @ ${new Date().toISOString()}`);
      } catch (e: any) { setStatus(`ERROR: ${String(e).slice(0, 200)}`); }
    })());
    return NextResponse.json({ ok: true, started: true, period, label, office, note: 'Computing in background. Check &status=1, then reload without refresh.' });
  }

  const cached = await prisma.appSetting.findUnique({ where: { key: CK } });
  if (!cached) return NextResponse.json({ period, label, office, note: 'Not computed yet — run &refresh=1 for this period/office, then &status=1.', totals: null, rows: [] });
  let data = JSON.parse(cached.value);

  // RECOMPUTE: re-derive stories/rate/expected/variance from the CACHED per-job data — NO FR calls. Use this
  // after importing/updating the story map (the FR revenue/hours/crew don't change, so no need to re-pull).
  if (sp.get('recompute') === '1') {
    const storiesRow = await prisma.appSetting.findUnique({ where: { key: 'exclusion_stories_map' } });
    const storiesMap: Record<string, number> = storiesRow ? JSON.parse(storiesRow.value) : {};
    const RATE_1 = 225, RATE_2 = 175;
    const custRows = await prisma.customer.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true, name: true } });
    const custName = new Map<string, string>(custRows.map(c => [String(c.externalId), c.name]));
    const extById = new Map<string, string>(custRows.map(c => [c.id, String(c.externalId)]));
    const leadRows = await prisma.lead.findMany({ where: { pmName: { not: null } }, select: { customerId: true, pmName: true } });
    const pmByExt = new Map<string, string>();
    for (const l of leadRows) { const e = extById.get(l.customerId); if (e && !pmByExt.has(e)) pmByExt.set(e, l.pmName!); }
    const perJob = (data.perJob || []).map((j: any) => {
      const stories = storiesMap[String(j.customerID)] || null;
      j.customer = custName.get(String(j.customerID)) || j.customer;
      j.pm = pmByExt.get(String(j.customerID)) || j.pm || 'Unassigned';
      const rate = stories === 1 ? RATE_1 : stories === 2 ? RATE_2 : null;
      // Use the stored per-day-accurate schedTechHours (Σ day hours × that day's crew). Only re-derive from
      // crewSize for old records saved before schedTechHours was persisted.
      const schedTechHours = j.schedTechHours != null ? j.schedTechHours : j.schedHours * Math.max(j.crewSize || 1, 1);
      const expectedTechHours = rate ? Math.round((j.exclusionRevenue / rate) * 100) / 100 : null;
      const varianceHours = expectedTechHours !== null ? Math.round((expectedTechHours - schedTechHours) * 100) / 100 : null;
      return { ...j, stories, rate, schedTechHours, expectedTechHours, varianceHours };
    });
    const tagged = perJob.filter((j: any) => j.rate !== null);
    const one = perJob.filter((j: any) => j.stories === 1), two = perJob.filter((j: any) => j.stories === 2);
    const sumRate = (arr: any[]) => { const h = arr.reduce((s, j) => s + j.schedTechHours, 0); return h > 0 ? Math.round((arr.reduce((s, j) => s + j.exclusionRevenue, 0) / h) * 100) / 100 : 0; };
    const sumExpected = tagged.reduce((s: number, j: any) => s + (j.expectedTechHours || 0), 0);
    const sumSched = tagged.reduce((s: number, j: any) => s + j.schedTechHours, 0);
    data.totals = { ...data.totals,
      jobsTagged: tagged.length, jobsUntagged: perJob.length - tagged.length,
      oneStoryJobs: one.length, twoStoryJobs: two.length,
      oneStoryBlendedRate: sumRate(one), twoStoryBlendedRate: sumRate(two),
      expectedTechHoursAtStandard: Math.round(sumExpected * 100) / 100,
      scheduledTechHoursTagged: Math.round(sumSched * 100) / 100,
      varianceHours: Math.round((sumExpected - sumSched) * 100) / 100,
    };
    // Rebuild PM scorecard from recomputed perJob.
    const pmAgg2 = new Map<string, any>();
    for (const j of perJob) {
      const pm = j.pm || 'Unassigned';
      let a = pmAgg2.get(pm); if (!a) { a = { pm, jobs: 0, revenue: 0, schedTechHours: 0, expectedTechHours: 0, oneRev: 0, oneHrs: 0, oneJobs: 0, twoRev: 0, twoHrs: 0, twoJobs: 0, rates: [] }; pmAgg2.set(pm, a); }
      a.jobs++; a.revenue += j.exclusionRevenue; a.schedTechHours += j.schedTechHours || 0; a.expectedTechHours += j.expectedTechHours || 0;
      if (j.schedTechHours > 0) a.rates.push(j.exclusionRevenue / j.schedTechHours);
      if (j.stories === 1) { a.oneRev += j.exclusionRevenue; a.oneHrs += j.schedTechHours || 0; a.oneJobs++; }
      else if (j.stories === 2) { a.twoRev += j.exclusionRevenue; a.twoHrs += j.schedTechHours || 0; a.twoJobs++; }
    }
    const stdev2 = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.round(Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) * 100) / 100; };
    data.byPM = [...pmAgg2.values()].map((a: any) => { const oneRate = a.oneHrs > 0 ? Math.round((a.oneRev / a.oneHrs) * 100) / 100 : 0; const twoRate = a.twoHrs > 0 ? Math.round((a.twoRev / a.twoHrs) * 100) / 100 : 0; return { pm: a.pm, jobs: a.jobs, exclusionRevenue: Math.round(a.revenue * 100) / 100, schedTechHours: Math.round(a.schedTechHours * 100) / 100, expectedTechHours: Math.round(a.expectedTechHours * 100) / 100, varianceHours: Math.round((a.expectedTechHours - a.schedTechHours) * 100) / 100, avgRevPerSchedTechHour: a.schedTechHours > 0 ? Math.round((a.revenue / a.schedTechHours) * 100) / 100 : 0, ratePerHourStdev: stdev2(a.rates), oneStoryJobs: a.oneJobs, oneStoryRate: oneRate, twoStoryJobs: a.twoJobs, twoStoryRate: twoRate, differentiation: (oneRate && twoRate) ? Math.round((oneRate - twoRate) * 100) / 100 : null }; }).sort((a: any, b: any) => b.exclusionRevenue - a.exclusionRevenue);
    data.perJob = perJob;
    // persist so the next plain read shows the enriched version too
    await prisma.appSetting.upsert({ where: { key: CK }, create: { key: CK, value: JSON.stringify(data) }, update: { value: JSON.stringify(data) } });
  }

  if (sp.get('csv') === '1') {
    if (sp.get('view') === 'pm') {
      const header = 'PM,Jobs,Exclusion Revenue,Sched Tech-Hours,Expected Tech-Hours,Variance,Avg $/Tech-Hour,1-Story Jobs,1-Story $/Hr,2-Story Jobs,2-Story $/Hr,Differentiation';
      const lines = (data.byPM || []).map((r: any) => [r.pm, r.jobs, r.exclusionRevenue, r.schedTechHours, r.expectedTechHours, r.varianceHours, r.avgRevPerSchedTechHour, r.oneStoryJobs, r.oneStoryRate, r.twoStoryJobs, r.twoStoryRate, r.differentiation].join(','));
      return new NextResponse([header, ...lines].join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="exclusion_by_PM_${data.from}_${data.to}.csv"` } });
    }
    if (sp.get('view') === 'jobs') {
      const header = 'Customer,PM,Office,Stories,Rate,Exclusion Revenue,Crew Size,Crew,Sched Tech-Hours,Expected Tech-Hours,Variance,$/Tech-Hour';
      const lines = (data.perJob || []).map((j: any) => [j.customer, j.pm, j.office, j.stories, j.rate, j.exclusionRevenue, j.crewSize, `"${(j.crew || []).join('; ')}"`, j.schedTechHours, j.expectedTechHours, j.varianceHours, j.revenuePerSchedTechHour].join(','));
      return new NextResponse([header, ...lines].join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="exclusion_by_job_${data.from}_${data.to}.csv"` } });
    }
    const header = 'Field Professional,Office,Jobs,Exclusion Revenue,Scheduled Tech-Hours,Expected Tech-Hours,Variance,Rev per Sched Tech-Hour,Trapping Revenue,Fogging Revenue';
    const lines = (data.rows || []).map((r: any) => [r.fieldProfessional, r.office, r.jobs, r.exclusionRevenue, r.scheduledHours, r.expectedHours, r.varianceHours, r.revenuePerSchedTechHour, r.trappingRevenue, r.foggingRevenue].join(','));
    return new NextResponse([header, ...lines].join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="exclusion_revenue_${data.from}_${data.to}.csv"` } });
  }
  return NextResponse.json({ from: data.from, to: data.to, offices: data.offices, computedAt: data.computedAt, totals: data.totals, byPM: data.byPM || [], rows: data.rows, perJob: sp.get('detail') === '1' ? data.perJob : (data.perJob || []).slice(0, 50) });
}
