// src/app/api/cron/field-performance/route.ts
// Weekly cron: pulls WP close-out%, callback rate, PMP route reporting + reservices
// Run every Sunday 12am CST via cron-job.org

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const SUBDOMAIN = 'critterstoppest';
const BASE_URL = `https://${SUBDOMAIN}.fieldroutes.com/api`;

const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

// ─── APPOINTMENT TYPE IDs ────────────────────────────────────────────────────
const TRAP_CHECK_TYPES       = new Set(['504', '636']);
const EXCLUSION_TYPES        = new Set(['553', '716']);
const CALLBACK_TYPES         = new Set(['615', '671', '546', '554']);
const CALLBACK_TC_TYPES      = new Set(['620']);
const ANNUAL_INSP_TYPES      = new Set(['533']);
const ANNUAL_INSP_TC_TYPES   = new Set(['538']);

// Close-out keywords (same as dispatcher)
const CLOSEOUT_KEYWORDS = ['ready for insulation', 'ready for far', 'closed out'];

// Standard production rate per hr-day for PMP revenue efficiency
const PROD_STANDARD_PER_DAY = 1150;

// ─── HELPERS ────────────────────────────────────────────────────────────────
function frUrl(endpoint: string, action: string, params: Record<string, string>, key: string, token: string) {
  const url = new URL(`${BASE_URL}/${endpoint}/${action}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('authenticationKey', key);
  url.searchParams.set('authenticationToken', token);
  return url.toString();
}

async function frFetch(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`FR HTTP ${res.status}`);
  return res.json();
}

async function fetchInBatches(endpoint: string, action: string, idParam: string, ids: any[], key: string, token: string): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const url = frUrl(endpoint, action, { [idParam]: batch.join(',') }, key, token);
    const data = await frFetch(url);
    const propName = data.propertyName;
    if (data.success && propName && data[propName]) {
      const items = Array.isArray(data[propName])
        ? data[propName]
        : Object.values(data[propName] as object);
      results.push(...items);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function hasCloseoutNote(appt: any): boolean {
  const text = [appt.officeNotes, appt.techNotes]
    .filter(Boolean).join(' ').toLowerCase();
  return CLOSEOUT_KEYWORDS.some(k => text.includes(k));
}

function getMostRecentFriday(offsetWeeks = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysToFri = day >= 5 ? day - 5 : day + 2;
  d.setDate(d.getDate() - daysToFri - offsetWeeks * 7);
  return d;
}

// ─── WP: CLOSE-OUT % + CALLBACK RATE ────────────────────────────────────────
// Close-out opportunities:
//   - TC #2+ (trap check where customer has >= 2 TCs after exclusion)
//   - Call Back (615, 671, 546, 554) — opportunity itself
//   - Call Back Trap Check (620)
//   - Annual Inspection (533)
//   - Annual Inspection Trap Check (538)
// Close-out = appointment has close-out note in tech/office notes
// Callback rate = CB appointments / jobs 60-120 days ago (handled separately)

interface TechWPStats {
  closeoutOpportunities: number;
  closeouts: number;
  callbacks: number;       // CB appts this week (for callback rate numerator)
}

async function pullWPMetrics(
  cfg: { key: string; token: string; officeId: number },
  weekStart: Date,
  weekEnd: Date,
  wpTechs: Map<number, string>,
  preloadedAppts?: any[]
): Promise<Map<string, TechWPStats>> {

  const result = new Map<string, TechWPStats>();
  const initStats = (): TechWPStats => ({ closeoutOpportunities: 0, closeouts: 0, callbacks: 0 });

  let allAppts: any[];
  if (preloadedAppts) {
    allAppts = preloadedAppts;
  } else {
    const searchUrl = frUrl('appointment', 'search', {
      officeIDs: String(cfg.officeId),
      dateStart: fmtDate(weekStart),
      dateEnd: fmtDate(weekEnd),
    }, cfg.key, cfg.token);
    const searchData = await frFetch(searchUrl);
    const apptIds: number[] = searchData.appointmentIDs || [];
    if (apptIds.length === 0) return result;
    allAppts = await fetchInBatches('appointment', 'get', 'appointmentIDs', apptIds, cfg.key, cfg.token);
  }

  // Only completed appointments
  const completed = allAppts.filter((a: any) => String(a.status) === '1');

  // Group trap checks by customer to determine TC count
  // We need ALL trap checks (not just this week) to determine TC #
  // Use the DispatchJob table which already tracks trapCheckCount per customer
  const customerTCCounts = new Map<string, number>();
  const dispatchJobs = await prisma.dispatchJob.findMany({
    where: { status: { in: ['ACTIVE', 'CLOSED'] } },
    select: { customer: { select: { externalId: true } }, trapCheckCount: true },
  });
  for (const job of dispatchJobs) {
    if (job.customer?.externalId) {
      customerTCCounts.set(job.customer.externalId, job.trapCheckCount ?? 0);
    }
  }

  for (const appt of completed) {
    const empId = parseInt(appt.servicedBy || appt.employeeID || appt.technicianID || '0');
    if (!empId || !wpTechs.has(empId)) continue;

    const techId = wpTechs.get(empId)!;
    const typeStr = String(appt.type || appt.serviceTypeID || '');
    const custId = String(appt.customerID);

    if (!result.has(techId)) result.set(techId, initStats());
    const stats = result.get(techId)!;

    // ── TRAP CHECKS (TC #2+) ──
    if (TRAP_CHECK_TYPES.has(typeStr)) {
      const tcCount = customerTCCounts.get(custId) ?? 0;
      if (tcCount >= 2) {
        // This is TC #2 or later — it's a close-out opportunity
        stats.closeoutOpportunities++;
        if (hasCloseoutNote(appt)) stats.closeouts++;
      }
      // TC #1 → not a close-out opportunity, skip
    }

    // ── CALLBACKS ── (opportunity + closed out if note present)
    else if (CALLBACK_TYPES.has(typeStr)) {
      stats.closeoutOpportunities++;
      stats.callbacks++;
      if (hasCloseoutNote(appt)) stats.closeouts++;
    }

    // ── CALLBACK TRAP CHECKS ── (same logic as TC #2+)
    else if (CALLBACK_TC_TYPES.has(typeStr)) {
      stats.closeoutOpportunities++;
      if (hasCloseoutNote(appt)) stats.closeouts++;
    }

    // ── ANNUAL INSPECTIONS ── (opportunity itself)
    else if (ANNUAL_INSP_TYPES.has(typeStr)) {
      stats.closeoutOpportunities++;
      if (hasCloseoutNote(appt)) stats.closeouts++;
    }

    // ── ANNUAL INSPECTION TRAP CHECKS ── (same as TC #2+)
    else if (ANNUAL_INSP_TC_TYPES.has(typeStr)) {
      stats.closeoutOpportunities++;
      if (hasCloseoutNote(appt)) stats.closeouts++;
    }
  }

  return result;
}

// ─── WP: CALLBACK RATE ───────────────────────────────────────────────────────
// Callback rate = CB appts in last 60-90 days / jobs completed 60-120 days ago
// Uses a rolling window, not the current week
async function pullWPCallbackRate(
  cfg: { key: string; token: string; officeId: number },
  weekEnd: Date,
  wpTechs: Map<number, string>
): Promise<Map<string, number>> {

  const result = new Map<string, number>();

  // Window: 30-90 days ago for callbacks
  const cbStart = new Date(weekEnd); cbStart.setDate(cbStart.getDate() - 90);
  const cbEnd   = new Date(weekEnd); cbEnd.setDate(cbEnd.getDate() - 30);

  // Window: 60-120 days ago for base jobs
  const baseStart = new Date(weekEnd); baseStart.setDate(baseStart.getDate() - 120);
  const baseEnd   = new Date(weekEnd); baseEnd.setDate(baseEnd.getDate() - 60);

  // Fetch callbacks in window
  const cbSearchUrl = frUrl('appointment', 'search', {
    officeIDs: String(cfg.officeId),
    dateStart: fmtDate(cbStart),
    dateEnd: fmtDate(cbEnd),
  }, cfg.key, cfg.token);
  const cbSearch = await frFetch(cbSearchUrl);
  const cbApptIds: number[] = cbSearch.appointmentIDs || [];

  // Fetch base jobs in window (exclusions + TCs = completed jobs)
  const baseSearchUrl = frUrl('appointment', 'search', {
    officeIDs: String(cfg.officeId),
    dateStart: fmtDate(baseStart),
    dateEnd: fmtDate(baseEnd),
  }, cfg.key, cfg.token);
  const baseSearch = await frFetch(baseSearchUrl);
  const baseApptIds: number[] = baseSearch.appointmentIDs || [];

  if (cbApptIds.length === 0 && baseApptIds.length === 0) return result;

  const [cbAppts, baseAppts] = await Promise.all([
    cbApptIds.length > 0 ? fetchInBatches('appointment', 'get', 'appointmentIDs', cbApptIds, cfg.key, cfg.token) : [],
    baseApptIds.length > 0 ? fetchInBatches('appointment', 'get', 'appointmentIDs', baseApptIds, cfg.key, cfg.token) : [],
  ]);

  // Count callbacks per tech
  const cbByTech = new Map<string, number>();
  for (const appt of cbAppts.filter((a: any) => String(a.status) === '1')) {
    const empId = parseInt(appt.servicedBy || appt.employeeID || appt.technicianID || '0');
    if (!empId || !wpTechs.has(empId)) continue;
    const typeStr = String(appt.type || '');
    if (!CALLBACK_TYPES.has(typeStr)) continue;
    const techId = wpTechs.get(empId)!;
    cbByTech.set(techId, (cbByTech.get(techId) ?? 0) + 1);
  }

  // Count base completed jobs per tech (exclusions + TCs)
  const baseByTech = new Map<string, number>();
  for (const appt of baseAppts.filter((a: any) => String(a.status) === '1')) {
    const empId = parseInt(appt.servicedBy || appt.employeeID || appt.technicianID || '0');
    if (!empId || !wpTechs.has(empId)) continue;
    const typeStr = String(appt.type || '');
    if (!EXCLUSION_TYPES.has(typeStr) && !TRAP_CHECK_TYPES.has(typeStr)) continue;
    const techId = wpTechs.get(empId)!;
    baseByTech.set(techId, (baseByTech.get(techId) ?? 0) + 1);
  }

  // Calculate rate per tech
  for (const [techId, cbs] of cbByTech) {
    const base = baseByTech.get(techId) ?? 0;
    if (base > 0) result.set(techId, cbs / base);
  }

  return result;
}

// ─── PMP: ROUTE REPORTING ────────────────────────────────────────────────────
async function pullRouteReporting(
  cfg: { key: string; token: string; officeId: number },
  weekStart: Date,
  weekEnd: Date,
  pmpTechs: Map<number, string>,
  preloadedAppts?: any[]
): Promise<Map<string, { totalScheduled: number; completed: number; productionValue: number }>> {

  const result = new Map<string, { totalScheduled: number; completed: number; productionValue: number }>();

  let allAppts: any[];
  if (preloadedAppts) {
    allAppts = preloadedAppts;
  } else {
    const searchUrl = frUrl('appointment', 'search', {
      officeIDs: String(cfg.officeId),
      dateStart: fmtDate(weekStart),
      dateEnd: fmtDate(weekEnd),
    }, cfg.key, cfg.token);
    const searchData = await frFetch(searchUrl);
    const apptIds: number[] = searchData.appointmentIDs || [];
    if (apptIds.length === 0) return result;
    allAppts = await fetchInBatches('appointment', 'get', 'appointmentIDs', apptIds, cfg.key, cfg.token);
  }

  for (const appt of allAppts) {
    const empId = parseInt(appt.servicedBy || appt.employeeID || appt.technicianID || '0');
    if (!empId || !pmpTechs.has(empId)) continue;

    const techId = pmpTechs.get(empId)!;
    const statusStr = String(appt.status || '');
    const isCompleted = statusStr === '1';
    const isPending   = statusStr === '0';
    if (!isCompleted && !isPending) continue;

    if (!result.has(techId)) {
      result.set(techId, { totalScheduled: 0, completed: 0, productionValue: 0 });
    }
    const entry = result.get(techId)!;
    entry.totalScheduled++;
    if (isCompleted) entry.completed++;
  }

  return result;
}

// ─── PMP: RESERVICES ─────────────────────────────────────────────────────────
async function pullReservices(
  cfg: { key: string; token: string; officeId: number },
  weekStart: Date,
  weekEnd: Date,
  pmpTechs: Map<number, string>
): Promise<Map<string, number>> {

  const result = new Map<string, number>();

  let searchData: any;
  try {
    const searchUrl = frUrl('reservice', 'search', {
      officeIDs: String(cfg.officeId),
      dateStart: fmtDate(weekStart),
      dateEnd: fmtDate(weekEnd),
    }, cfg.key, cfg.token);
    searchData = await frFetch(searchUrl);
  } catch { return result; }

  const reserviceIds: number[] = searchData.reserviceIDs || searchData.reServiceIDs || [];
  if (reserviceIds.length === 0) return result;

  const reservices = await fetchInBatches('reservice', 'get', 'reserviceIDs', reserviceIds, cfg.key, cfg.token);

  for (const rs of reservices) {
    const empId = parseInt(rs.servicedBy || rs.employeeID || rs.technicianID || '0');
    if (!empId || !pmpTechs.has(empId)) continue;
    const techId = pmpTechs.get(empId)!;
    result.set(techId, (result.get(techId) ?? 0) + 1);
  }

  return result;
}

// ─── SCORING ─────────────────────────────────────────────────────────────────
function calcWPScore(coPct: number, cbRate: number | null, driving: number, reliability: number): number {
  const coTerm  = Math.min(coPct + (1 - 0.85), 1.1) * 0.45;
  const cbTerm  = cbRate !== null
    ? ((1 + 0.15 * 2) - cbRate * 2) * 0.30
    : Math.min(coPct + (1 - 0.85), 1.1) * 0.30; // carry-forward if no CB data
  return coTerm + cbTerm + driving * 0.10 + reliability * 0.15;
}

function calcPMPScore(revEff: number, reservice: number, completion: number, driving: number, reliability: number): number {
  return (
    revEff * 0.35 +
    (0.95 + 0.10 - reservice) * 0.20 +
    (1 - (0.95 - completion) * 5) * 0.20 +
    driving * 0.10 +
    reliability * 0.15
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekEndParam = searchParams.get('weekEnd');
  const weekEnd = weekEndParam
    ? new Date(weekEndParam + 'T00:00:00.000Z')
    : getMostRecentFriday();

  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  // Load all active techs with FR employee IDs
  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE', frEmployeeId: { not: null } },
  });

  const log: string[] = [`Week: ${fmtDate(weekStart)} → ${fmtDate(weekEnd)}`];
  const errors: string[] = [];
  let updated = 0;

  const officeFilter = searchParams.get('office') || '';

  for (const [officeName, cfg] of Object.entries(OFFICES)) {
    if (officeFilter && officeName.toLowerCase() !== officeFilter.toLowerCase()) continue;
    if (!cfg.key || !cfg.token) { log.push(`${officeName}: skipped (no API key)`); continue; }

    log.push(`\n--- ${officeName} ---`);

    const officeTechs = techs.filter(t => t.office === officeName && t.frEmployeeId);
    const wpTechs  = new Map(officeTechs.filter(t => t.team === 'WP').map(t => [t.frEmployeeId!, t.techId]));
    const pmpTechs = new Map(officeTechs.filter(t => t.team === 'PMP').map(t => [t.frEmployeeId!, t.techId]));

    try {
      // ── WP DATA: fetch appointments (needed for close-out + callback analysis) ──
      let allAppts: any[] = [];
      if (wpTechs.size > 0) {
        const searchUrl = frUrl('appointment', 'search', {
          officeIDs: String(cfg.officeId),
          dateStart: fmtDate(weekStart),
          dateEnd: fmtDate(weekEnd),
        }, cfg.key, cfg.token);
        const searchData = await frFetch(searchUrl);
        const apptIds: number[] = searchData.appointmentIDs || [];
        log.push(`  ${officeName}: ${apptIds.length} appointment IDs`);
        allAppts = apptIds.length > 0
          ? await fetchInBatches('appointment', 'get', 'appointmentIDs', apptIds, cfg.key, cfg.token)
          : [];
        log.push(`  ${officeName}: ${allAppts.length} appointments fetched`);
      }

      const [wpMetrics, wpCallbacks] = await Promise.all([
        wpTechs.size > 0 ? pullWPMetrics(cfg, weekStart, weekEnd, wpTechs, allAppts) : Promise.resolve(new Map()),
        wpTechs.size > 0 ? pullWPCallbackRate(cfg, weekEnd, wpTechs) : Promise.resolve(new Map()),
      ]);

      // ── PMP DATA: use route API directly (much lighter than appointment fetch) ──
      const pmpRoutes = new Map<string, { totalScheduled: number; completed: number; productionValue: number }>();
      const pmpReserviceMap = new Map<string, number>();

      if (pmpTechs.size > 0) {
        // Route API for completion % and production value
        try {
          const routeSearchUrl = frUrl('route', 'search', {
            officeIDs: String(cfg.officeId),
            dateStart: fmtDate(weekStart),
            dateEnd: fmtDate(weekEnd),
          }, cfg.key, cfg.token);
          const routeSearch = await frFetch(routeSearchUrl);
          const routeIds: number[] = routeSearch.routeIDs || [];
          log.push(`  ${officeName}: ${routeIds.length} route IDs`);

          if (routeIds.length > 0) {
            const routes = await fetchInBatches('route', 'get', 'routeIDs', routeIds, cfg.key, cfg.token);
            log.push(`  ${officeName}: ${routes.length} routes fetched`);
            if (routes.length > 0) log.push(`  Route keys: ${Object.keys(routes[0]).join(',')}`);

            // Try to get spot data for first PMP route to find production value
            const pmpRoute = routes.find((r: any) => {
              const empId = parseInt(r.assignedTech || r.employeeID || '0');
              return pmpTechs.has(empId);
            });
            if (pmpRoute) {
              try {
                const spotUrl = frUrl('spot', 'search', {
                  officeIDs: String(cfg.officeId),
                  routeIDs: String(pmpRoute.routeID),
                }, cfg.key, cfg.token);
                const spotSearch = await frFetch(spotUrl);
                const spotIds: number[] = spotSearch.spotIDs || [];
                log.push(`  Spot search for route ${pmpRoute.routeID}: ${spotIds.length} spots`);
                if (spotIds.length > 0) {
                  const spots = await fetchInBatches('spot', 'get', 'spotIDs', spotIds.slice(0,10), cfg.key, cfg.token);
                  if (spots.length > 0) {
                    log.push(`  Spot keys: ${Object.keys(spots[0]).join(',')}`);
                    log.push(`  Spot sample: status=${spots[0].status}, completed=${spots[0].completed}, value=${spots[0].value || spots[0].servicePrice || spots[0].price || spots[0].amount}`);
                  }
                }
              } catch (e: any) {
                log.push(`  Spot error: ${e.message}`);
              }
            }
            for (const route of routes) {
              const empId = parseInt(route.assignedTech || route.employeeID || route.technicianID || '0');
              if (!empId || !pmpTechs.has(empId)) continue;
              const techId = pmpTechs.get(empId) as string | undefined;
              if (!techId) continue;
              const prodVal = parseFloat(String(route.productionValue || route.routeValue || '0'));
              const scheduled = parseInt(String(route.totalScheduled || route.scheduledServices || '0'));
              const completed = parseInt(String(route.completedServices || route.completed || '0'));

              if (!pmpRoutes.has(techId)) pmpRoutes.set(techId, { totalScheduled: 0, completed: 0, productionValue: 0 });
              const entry = pmpRoutes.get(techId)!;
              entry.productionValue += prodVal;
              entry.totalScheduled += scheduled;
              entry.completed += completed;
            }
          }
        } catch (e: any) {
          log.push(`  Route API error: ${e.message}`);
        }

        // Reservice API
        try {
          const rsMap = await pullReservices(cfg, weekStart, weekEnd, pmpTechs);
          for (const [k, v] of rsMap) pmpReserviceMap.set(k, v);
        } catch (e: any) {
          log.push(`  Reservice API error: ${e.message}`);
        }
      }

      log.push(`WP techs: ${wpMetrics.size}, PMP routes: ${pmpRoutes.size}`);

      // ── UPSERT WP ──
      for (const tech of officeTechs.filter(t => t.team === 'WP')) {
        const metrics = wpMetrics.get(tech.techId);
        const cbRate  = wpCallbacks.get(tech.techId) ?? null;
        if (!metrics && cbRate === null) continue;

        const coOpps  = metrics?.closeoutOpportunities ?? 0;
        const coCount = metrics?.closeouts ?? 0;
        const coPct   = coOpps > 0 ? coCount / coOpps : null;

        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
        });

        const updateData: any = {
          closeOutPct:  coPct,
          callbackRate: cbRate,
          coJobs:       coCount,
          updatedAt:    new Date(),
        };

        // Recalculate WP score if driving + reliability available
        if (coPct !== null && existing?.drivingScore && existing?.reliabilityScore) {
          const wpScore = calcWPScore(coPct, cbRate, existing.drivingScore, existing.reliabilityScore);
          updateData.wpScore    = wpScore;
          updateData.totalScore = wpScore + (existing.manualAdj ?? 0);
        }

        if (existing) {
          await prisma.techWeek.update({
            where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
            data: updateData,
          });
        } else {
          await prisma.techWeek.create({
            data: {
              id: crypto.randomUUID(),
              technicianId: tech.id,
              techId: tech.techId,
              weekEnd,
              office: tech.office,
              team: tech.team,
              siteLeader:   tech.siteLeader,
              crewLeader:   tech.crewLeader,
              closeOutPct:  coPct,
              callbackRate: cbRate,
              coJobs:       coCount,
              manualAdj:    0,
            },
          });
        }

        updated++;
        log.push(`  ${tech.techId} ${tech.name}: CO=${coPct !== null ? (coPct*100).toFixed(0)+'%' : '—'} (${coCount}/${coOpps}), CB=${cbRate !== null ? (cbRate*100).toFixed(1)+'%' : '—'}`);
      }

      // ── UPSERT PMP ──
      for (const tech of officeTechs.filter(t => t.team === 'PMP')) {
        const routes    = pmpRoutes.get(tech.techId);
        const resvCount = pmpReserviceMap.get(tech.techId) ?? 0;
        if (!routes) continue;

        const completionPct    = routes.totalScheduled > 0 ? routes.completed / routes.totalScheduled : null;
        const stdDays          = tech.hrDays === 10 ? 4 : 5;
        const revenueEff       = routes.productionValue > 0
          ? Math.min(routes.productionValue / (stdDays * PROD_STANDARD_PER_DAY), 1.1)
          : null;
        const reseviceRate     = routes.completed > 0 ? resvCount / routes.completed : 0;

        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
        });

        const updateData: any = {
          completionPct,
          revenueEfficiency: revenueEff,
          productionValue:   routes.productionValue,
          reseviceRate,
          updatedAt: new Date(),
        };

        if (revenueEff !== null && completionPct !== null &&
            existing?.drivingScore && existing?.reliabilityScore) {
          const pmpScore = calcPMPScore(revenueEff, reseviceRate, completionPct, existing.drivingScore, existing.reliabilityScore);
          updateData.pmpScore   = pmpScore;
          updateData.totalScore = pmpScore + (existing.manualAdj ?? 0);
        }

        if (existing) {
          await prisma.techWeek.update({
            where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
            data: updateData,
          });
        } else {
          await prisma.techWeek.create({
            data: {
              id: crypto.randomUUID(),
              technicianId: tech.id,
              techId: tech.techId,
              weekEnd,
              office: tech.office,
              team: tech.team,
              siteLeader:        tech.siteLeader,
              crewLeader:        tech.crewLeader,
              completionPct,
              revenueEfficiency: revenueEff,
              productionValue:   routes.productionValue,
              reseviceRate,
              manualAdj: 0,
            },
          });
        }

        updated++;
        log.push(`  ${tech.techId} ${tech.name}: completion=${completionPct !== null ? (completionPct*100).toFixed(0)+'%' : '—'}, revEff=${revenueEff?.toFixed(2) ?? '—'}, reservice=${(reseviceRate*100).toFixed(1)}%`);
      }

    } catch (e: any) {
      const msg = `${officeName} error: ${e.message}`;
      errors.push(msg);
      log.push(msg);
    }
    // Pause between offices to avoid FR rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  log.push(`\nTotal techs updated: ${updated}`);

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    weekEnd: fmtDate(weekEnd),
    weekStart: fmtDate(weekStart),
    techsUpdated: updated,
    executedAt: new Date().toISOString(),
    errors,
    log: log.join('\n'),
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}

