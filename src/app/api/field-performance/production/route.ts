// src/app/api/field-performance/production/route.ts
// Syncs production value (current week) + completion % (last 30 days) for PMP techs

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

const PROD_STANDARD_PER_DAY = 5676.92;

function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }

function getMostRecentFriday(offsetWeeks = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysToFri = day >= 5 ? day - 5 : day + 2;
  d.setDate(d.getDate() - daysToFri - offsetWeeks * 7);
  return d;
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

// ============================================================
// RATE LIMITER — exactly as provided, zero modifications
// ============================================================
let callCount = 0;
let minuteStart = Date.now();

async function rateLimitedFetch(url: string): Promise<any> {
  if (Date.now() - minuteStart > 60000) {
    callCount = 0;
    minuteStart = Date.now();
  }
  if (callCount >= 55) {
    const waitTime = 60000 - (Date.now() - minuteStart) + 1000;
    await new Promise(res => setTimeout(res, waitTime));
    callCount = 0;
    minuteStart = Date.now();
  }
  callCount++;
  return fetch(url).then(r => r.json());
}

// ============================================================
// GET ROUTE STATS — exactly as provided, zero modifications
// ============================================================
async function getRouteStats(routeID: string, key: string, token: string) {
  const base = 'https://critterstoppest.fieldroutes.com/api';
  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;

  const spotSearch = await rateLimitedFetch(`${base}/spot/search?routeID=${routeID}${auth}`);
  const spotIDs: string[] = spotSearch.spotIDs || [];
  if (spotIDs.length === 0) return null;

  const spotData = await rateLimitedFetch(`${base}/spot/get?spotIDs=${spotIDs.join(',')}${auth}`);
  const apptIDs: string[] = [];
  spotData.spots?.forEach((s: any) => { if (s.appointmentIDs?.length) apptIDs.push(...s.appointmentIDs); });
  if (apptIDs.length === 0) return null;

  const apptData = await rateLimitedFetch(`${base}/appointment/get?appointmentIDs=${apptIDs.join(',')}${auth}`);
  const appointments: any[] = apptData.appointments || [];

  const completed = appointments.filter((a: any) => a.status === '1').length;
  const pending = appointments.filter((a: any) => a.status === '0').length;
  const noShow = appointments.filter((a: any) => a.statusText === 'No Show').length;

  const validAppts = appointments.filter((a: any) => a.status !== '-1');

  const subIDs = [...new Set(validAppts.map((a: any) => a.subscriptionID).filter((s: any) => parseInt(s) > 0))];
  const subMap = new Map<string, any>();
  if (subIDs.length > 0) {
    const subData = await rateLimitedFetch(`${base}/subscription/get?subscriptionIDs=${subIDs.join(',')}${auth}`);
    subData.subscriptions?.forEach((s: any) => {
      const recurringTicketPV = parseFloat(s.recurringTicket?.productionValue || 0);
      const recurring = parseFloat(s.recurringCharge || 0);
      const initial = parseFloat(s.initialServiceTotal || 0);
      let value = 0;
      if (recurringTicketPV > 0) value = recurringTicketPV;
      else if (recurring > 0) value = recurring;
      else value = initial;
      subMap.set(String(s.subscriptionID), { value, recurring, recurringTicketPV });
    });
  }

  const ticketIDs = [...new Set(validAppts.map((a: any) => a.ticketID).filter((t: any) => t && t !== '0'))];
  const ticketMap = new Map<string, number>();
  if (ticketIDs.length > 0) {
    const ticketData = await rateLimitedFetch(`${base}/ticket/get?ticketIDs=${ticketIDs.join(',')}${auth}`);
    ticketData.tickets?.forEach((t: any) => ticketMap.set(String(t.ticketID), parseFloat(t.subTotal || 0)));
  }

  let productionValue = 0;
  for (const a of validAppts) {
    const isNoShow = a.statusText === 'No Show';
    const hasSub = parseInt(a.subscriptionID) > 0;
    const subInfo = subMap.get(String(a.subscriptionID));
    const hasTicket = a.ticketID && a.ticketID !== '0';
    const ticketSubTotal = hasTicket ? (ticketMap.get(String(a.ticketID)) || 0) : 0;

    if (isNoShow) {
      if (hasSub && subInfo?.recurring > 0) {
        productionValue += subInfo.recurring;
      } else if (hasTicket && ticketSubTotal > 0) {
        productionValue += ticketSubTotal;
      }
    } else {
      if (hasTicket) {
        if (ticketSubTotal > 0) {
          productionValue += ticketSubTotal;
        } else if (hasSub && subInfo?.recurringTicketPV > 0) {
          productionValue += subInfo.recurringTicketPV;
        }
      } else if (hasSub && subMap.has(String(a.subscriptionID))) {
        productionValue += subInfo.value;
      }
    }
  }

  return { routeID, completed, pending, noShow, productionValue };
}

// ============================================================
// GET ROUTES FOR DATE RANGE — exactly as provided, zero modifications
// ============================================================
async function getRoutesForDateRange(dateStart: string, dateEnd: string, key: string, token: string) {
  const base = 'https://critterstoppest.fieldroutes.com/api';
  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;

  const routeSearch = await rateLimitedFetch(`${base}/route/search?${auth}`);
  const allRouteIDs: string[] = routeSearch.routeIDs || [];

  const recentIDs = allRouteIDs.slice(-1000);
  const matchingRoutes: any[] = [];

  for (let i = 0; i < recentIDs.length; i += 100) {
    const batch = recentIDs.slice(i, i + 100).join(',');
    const routeData = await rateLimitedFetch(`${base}/route/get?routeIDs=${batch}${auth}`);
    routeData.routes?.forEach((r: any) => {
      if (r.date >= dateStart && r.date <= dateEnd && r.assignedTech && r.assignedTech !== '0') {
        matchingRoutes.push({
          routeID: r.routeID,
          date: r.date,
          assignedTech: r.assignedTech,
          title: r.title,
        });
      }
    });
  }
  return matchingRoutes;
}

// ============================================================
// GET TECH STATS — exactly as provided, zero modifications
// ============================================================
async function getTechStats(weekStart: string, weekEnd: string, thirtyDayStart: string, key: string, token: string) {
  const base = 'https://critterstoppest.fieldroutes.com/api';
  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;

  const weekRoutes = await getRoutesForDateRange(weekStart, weekEnd, key, token);
  const thirtyDayRoutes = await getRoutesForDateRange(thirtyDayStart, weekEnd, key, token);

  const allTechIDs = [...new Set([
    ...weekRoutes.map((r: any) => r.assignedTech),
    ...thirtyDayRoutes.map((r: any) => r.assignedTech),
  ].filter(Boolean))];

  const techMap = new Map<string, string>();
  if (allTechIDs.length > 0) {
    const empData = await rateLimitedFetch(`${base}/employee/get?employeeIDs=${allTechIDs.join(',')}${auth}`);
    empData.employees?.forEach((e: any) => techMap.set(String(e.employeeID), `${e.fname} ${e.lname}`.trim()));
  }

  const techWeekProduction = new Map<string, number>();
  const techThirtyDay = new Map<string, { completed: number; pending: number; noShow: number }>();

  const weekRouteIDs = new Set(weekRoutes.map((r: any) => r.routeID));

  for (const route of weekRoutes) {
    const stats = await getRouteStats(route.routeID, key, token);
    if (!stats) continue;
    const tech = route.assignedTech;
    techWeekProduction.set(tech, (techWeekProduction.get(tech) || 0) + stats.productionValue);
    const prev = techThirtyDay.get(tech) || { completed: 0, pending: 0, noShow: 0 };
    techThirtyDay.set(tech, {
      completed: prev.completed + stats.completed,
      pending: prev.pending + stats.pending,
      noShow: prev.noShow + stats.noShow,
    });
  }

  const thirtyDayOnly = thirtyDayRoutes.filter((r: any) => !weekRouteIDs.has(r.routeID));
  for (const route of thirtyDayOnly) {
    const stats = await getRouteStats(route.routeID, key, token);
    if (!stats) continue;
    const tech = route.assignedTech;
    const prev = techThirtyDay.get(tech) || { completed: 0, pending: 0, noShow: 0 };
    techThirtyDay.set(tech, {
      completed: prev.completed + stats.completed,
      pending: prev.pending + stats.pending,
      noShow: prev.noShow + stats.noShow,
    });
  }

  const results = [];
  for (const techID of allTechIDs) {
    const production = techWeekProduction.get(techID) || 0;
    const thirtyD = techThirtyDay.get(techID) || { completed: 0, pending: 0, noShow: 0 };
    const total30d = thirtyD.completed + thirtyD.pending + thirtyD.noShow;
    const completionRate = total30d > 0 ? thirtyD.completed / total30d : 0;
    results.push({ techID, production, completionRate, completed30d: thirtyD.completed, total30d });
  }

  return results;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekEndParam = searchParams.get('weekEnd');
  const weekEnd = weekEndParam ? new Date(weekEndParam + 'T00:00:00.000Z') : getMostRecentFriday();
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const thirtyDayStart = new Date(weekEnd);
  thirtyDayStart.setDate(thirtyDayStart.getDate() - 29);

  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE', frEmployeeId: { not: null } },
  });

  const log: string[] = [`Week: ${fmtDate(weekStart)} → ${fmtDate(weekEnd)}`];
  const log30d = `30-day: ${fmtDate(thirtyDayStart)} → ${fmtDate(weekEnd)}`;
  log.push(log30d);
  const errors: string[] = [];
  let updated = 0;

  const officeFilter = searchParams.get('office') || '';

  for (const [officeName, cfg] of Object.entries(OFFICES)) {
    if (officeFilter && officeName.toLowerCase() !== officeFilter.toLowerCase()) continue;
    if (!cfg.key || !cfg.token) { log.push(`${officeName}: skipped (no API key)`); continue; }

    log.push(`\n--- ${officeName} ---`);
    const officeTechs = techs.filter(t => t.office === officeName && t.frEmployeeId);
    const pmpTechs = new Map(officeTechs.filter(t => t.team === 'PMP').map(t => [String(t.frEmployeeId!), t.techId]));

    if (pmpTechs.size === 0) { log.push(`  No PMP techs`); continue; }

    try {
      // Reset rate limiter per office
      callCount = 0;
      minuteStart = Date.now();

      const results = await getTechStats(
        fmtDate(weekStart), fmtDate(weekEnd), fmtDate(thirtyDayStart),
        cfg.key, cfg.token
      );

      log.push(`  Routes processed: ${results.length} techs`);

      for (const r of results) {
        const techId = pmpTechs.get(String(r.techID));
        if (!techId) continue;

        const tech = officeTechs.find(t => t.techId === techId);
        if (!tech) continue;

        const completionPct = r.completionRate;
        const productionValue = r.production;
        const routeCount = results.filter(x => x.techID === r.techID).length || 1;
        const hrDays = tech.hrDays || 8;
        const revenueEff = productionValue > 0
          ? Math.min((productionValue / routeCount / hrDays * 40) / PROD_STANDARD_PER_DAY, 1.1)
          : null;

        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId, weekEnd } },
        });

        const updateData: any = {
          completionPct,
          productionValue,
          revenueEfficiency: revenueEff,
          updatedAt: new Date(),
        };

        if (revenueEff !== null && existing?.reseviceRate !== null && existing?.reseviceRate !== undefined &&
            existing?.drivingScore && existing?.reliabilityScore) {
          const pmpScore = calcPMPScore(revenueEff, existing.reseviceRate!, completionPct, existing.drivingScore, existing.reliabilityScore);
          updateData.pmpScore   = pmpScore;
          updateData.totalScore = pmpScore + (existing.manualAdj ?? 0);
        }

        if (existing) {
          await prisma.techWeek.update({
            where: { techId_weekEnd: { techId, weekEnd } },
            data: updateData,
          });
        } else {
          await prisma.techWeek.create({
            data: {
              id: crypto.randomUUID(),
              technicianId: tech.id,
              techId,
              weekEnd,
              office: tech.office,
              team: tech.team,
              siteLeader:       tech.siteLeader,
              crewLeader:       tech.crewLeader,
              completionPct,
              productionValue,
              revenueEfficiency: revenueEff,
              manualAdj: 0,
            },
          });
        }

        updated++;
        log.push(`  ${techId} ${tech.name}: completion=${(completionPct*100).toFixed(1)}%, prod=$${productionValue.toFixed(2)}, revEff=${revenueEff !== null ? (revenueEff*100).toFixed(0)+'%' : '—'}`);
      }

    } catch (e: any) {
      const msg = `${officeName} error: ${e.message}`;
      errors.push(msg);
      log.push(msg);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  log.push(`\nTotal techs updated: ${updated}`);

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    weekEnd: fmtDate(weekEnd),
    weekStart: fmtDate(weekStart),
    thirtyDayStart: fmtDate(thirtyDayStart),
    techsUpdated: updated,
    executedAt: new Date().toISOString(),
    errors,
    log: log.join('\n'),
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}
