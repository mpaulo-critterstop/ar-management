export const maxDuration = 300;

// src/app/api/field-performance/production/route.ts
// Handles CStat PMP route reporting: production value (week) + completion rate (30d)
// Run via cron or manually: /api/field-performance/production?token=critterstop2026&office=CStat&weekEnd=2026-06-12

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!   },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!   },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!   },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

// ============================================================
// RATE LIMITER
// ============================================================
function makeRateLimiter() {
  let callCount = 0;
  let minuteStart = Date.now();
  return async function rateLimitedFetch(url: string): Promise<any> {
    if (Date.now() - minuteStart > 60000) {
      callCount = 0;
      minuteStart = Date.now();
    }
    if (callCount >= 55) {
      const waitTime = 60000 - (Date.now() - minuteStart) + 1000;
      await new Promise(r => setTimeout(r, waitTime));
      callCount = 0;
      minuteStart = Date.now();
    }
    callCount++;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`FR HTTP ${res.status} for ${url}`);
    return res.json();
  };
}

// ============================================================
// GET ROUTE STATS — verified 100% accurate vs FR ✅
// ============================================================
async function getRouteStats(
  routeID: string,
  key: string,
  token: string,
  rl: (url: string) => Promise<any>
): Promise<{ routeID: string; completed: number; pending: number; noShow: number; productionValue: number } | null> {

  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;

  const spotSearch = await rl(`${BASE_URL}/spot/search?routeID=${routeID}${auth}`);
  const spotIDs: string[] = spotSearch.spotIDs || [];
  if (spotIDs.length === 0) return null;

  const spotData = await rl(`${BASE_URL}/spot/get?spotIDs=${spotIDs.join(',')}${auth}`);
  const apptIDs: string[] = [];
  (spotData.spots || []).forEach((s: any) => {
    if (s.appointmentIDs?.length) apptIDs.push(...s.appointmentIDs);
  });
  if (apptIDs.length === 0) return null;

  const apptData = await rl(`${BASE_URL}/appointment/get?appointmentIDs=${apptIDs.join(',')}${auth}`);
  const appointments: any[] = apptData.appointments || [];

  const completed = appointments.filter(a => a.status === '1').length;
  const pending   = appointments.filter(a => a.status === '0').length;
  const noShow    = appointments.filter(a => a.statusText === 'No Show').length;
  const validAppts = appointments.filter(a => a.status !== '-1');

  // Batch fetch subscriptions
  const subIDs = [...new Set(validAppts.map((a: any) => a.subscriptionID).filter((s: any) => parseInt(s) > 0))];
  const subMap = new Map<string, { value: number; recurring: number; recurringTicketPV: number }>();
  if (subIDs.length > 0) {
    const subData = await rl(`${BASE_URL}/subscription/get?subscriptionIDs=${subIDs.join(',')}${auth}`);
    (subData.subscriptions || []).forEach((s: any) => {
      const recurringTicketPV = parseFloat(s.recurringTicket?.productionValue || 0);
      const recurring = parseFloat(s.recurringCharge || 0);
      const initial   = parseFloat(s.initialServiceTotal || 0);
      let value = 0;
      if (recurringTicketPV > 0) value = recurringTicketPV;
      else if (recurring > 0)    value = recurring;
      else                        value = initial;
      subMap.set(String(s.subscriptionID), { value, recurring, recurringTicketPV });
    });
  }

  // Batch fetch tickets
  const ticketIDs = [...new Set(validAppts.map((a: any) => a.ticketID).filter((t: any) => t && t !== '0'))];
  const ticketMap = new Map<string, number>();
  if (ticketIDs.length > 0) {
    const ticketData = await rl(`${BASE_URL}/ticket/get?ticketIDs=${ticketIDs.join(',')}${auth}`);
    (ticketData.tickets || []).forEach((t: any) => ticketMap.set(String(t.ticketID), parseFloat(t.subTotal || 0)));
  }

  // Calculate production value
  let productionValue = 0;
  for (const a of validAppts) {
    const isNoShow    = a.statusText === 'No Show';
    const hasSub      = parseInt(a.subscriptionID) > 0;
    const subInfo     = subMap.get(String(a.subscriptionID));
    const hasTicket   = a.ticketID && a.ticketID !== '0';
    const ticketSubTotal = hasTicket ? (ticketMap.get(String(a.ticketID)) || 0) : null;

    if (isNoShow) {
      if (hasSub && subInfo && subInfo.recurring > 0)         productionValue += subInfo.recurring;
      else if (hasTicket && ticketSubTotal && ticketSubTotal > 0) productionValue += ticketSubTotal;
    } else {
      if (hasTicket) {
        if (ticketSubTotal && ticketSubTotal > 0)                        productionValue += ticketSubTotal;
        else if (hasSub && subInfo && subInfo.recurringTicketPV > 0)     productionValue += subInfo.recurringTicketPV;
      } else if (hasSub && subInfo) {
        productionValue += subInfo.value;
      }
    }
  }

  return { routeID, completed, pending, noShow, productionValue };
}

// ============================================================
// GET ROUTES FOR DATE RANGE
// Uses last 1000 route IDs to capture all recent routes
// ============================================================
async function getRoutesForDateRange(
  dateStart: string,
  dateEnd: string,
  key: string,
  token: string,
  rl: (url: string) => Promise<any>
): Promise<Array<{ routeID: string; date: string; assignedTech: string }>> {

  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;
  const routeSearch = await rl(`${BASE_URL}/route/search?${auth}`);
  const allRouteIDs: string[] = routeSearch.routeIDs || [];
  const recentIDs = allRouteIDs.slice(-1000);
  const matchingRoutes: Array<{ routeID: string; date: string; assignedTech: string }> = [];

  for (let i = 0; i < recentIDs.length; i += 100) {
    const batch = recentIDs.slice(i, i + 100).join(',');
    const routeData = await rl(`${BASE_URL}/route/get?routeIDs=${batch}${auth}`);
    (routeData.routes || []).forEach((r: any) => {
      if (r.date >= dateStart && r.date <= dateEnd && r.assignedTech && r.assignedTech !== '0') {
        matchingRoutes.push({ routeID: String(r.routeID), date: r.date, assignedTech: String(r.assignedTech) });
      }
    });
  }
  return matchingRoutes;
}

// ============================================================
// MAIN HANDLER
// ============================================================
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const officeFilter = searchParams.get('office') || 'CStat';
  const weekEndParam = searchParams.get('weekEnd');

  // Default to most recent Sunday
  let weekEnd: Date;
  if (weekEndParam) {
    weekEnd = new Date(weekEndParam + 'T00:00:00.000Z');
  } else {
    weekEnd = new Date();
    weekEnd.setHours(0, 0, 0, 0);
    const day = weekEnd.getDay();
    weekEnd.setDate(weekEnd.getDate() - day); // back to Sunday
  }

  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6); // Monday

  const thirtyDayStart = new Date(weekEnd);
  thirtyDayStart.setDate(weekEnd.getDate() - 29);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const weekStartStr     = fmt(weekStart);
  const weekEndStr       = fmt(weekEnd);
  const thirtyDayStartStr = fmt(thirtyDayStart);

  const log: string[] = [
    `Office: ${officeFilter}`,
    `Week: ${weekStartStr} → ${weekEndStr}`,
    `30-day: ${thirtyDayStartStr} → ${weekEndStr}`,
  ];

  const cfg = OFFICES[officeFilter];
  if (!cfg) return NextResponse.json({ error: `Unknown office: ${officeFilter}` }, { status: 400 });
  if (!cfg.key || !cfg.token) return NextResponse.json({ error: `Missing API keys for ${officeFilter}` }, { status: 500 });

  const rl = makeRateLimiter();

  try {
    // ── Step 1: Find week routes ──
    log.push('Fetching week routes...');
    const weekRoutes = await getRoutesForDateRange(weekStartStr, weekEndStr, cfg.key, cfg.token, rl);
    log.push(`Week routes found: ${weekRoutes.length}`);

    // ── Step 2: Find 30-day routes ──
    log.push('Fetching 30-day routes...');
    const thirtyDayRoutes = await getRoutesForDateRange(thirtyDayStartStr, weekEndStr, cfg.key, cfg.token, rl);
    log.push(`30-day routes found: ${thirtyDayRoutes.length}`);

    // ── Step 3: Resolve tech names ──
    const allTechIDs = [...new Set([
      ...weekRoutes.map(r => r.assignedTech),
      ...thirtyDayRoutes.map(r => r.assignedTech),
    ])];
    const techNameMap = new Map<string, string>();
    if (allTechIDs.length > 0) {
      const auth = `&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
      const empData = await rl(`${BASE_URL}/employee/get?employeeIDs=${allTechIDs.join(',')}${auth}`);
      (empData.employees || []).forEach((e: any) => {
        techNameMap.set(String(e.employeeID), `${e.fname} ${e.lname}`.trim());
      });
    }

    // ── Step 4: Process week routes → production + 30d stats ──
    const techWeekProduction = new Map<string, number>();
    const techThirtyDay = new Map<string, { completed: number; pending: number; noShow: number }>();
    const weekRouteIDs = new Set(weekRoutes.map(r => r.routeID));

    for (const route of weekRoutes) {
      const stats = await getRouteStats(route.routeID, cfg.key, cfg.token, rl);
      if (!stats) continue;
      const tech = route.assignedTech;

      techWeekProduction.set(tech, (techWeekProduction.get(tech) || 0) + stats.productionValue);

      const prev = techThirtyDay.get(tech) || { completed: 0, pending: 0, noShow: 0 };
      techThirtyDay.set(tech, {
        completed: prev.completed + stats.completed,
        pending:   prev.pending   + stats.pending,
        noShow:    prev.noShow    + stats.noShow,
      });

      log.push(`Week route ${route.routeID} (${route.date}) ${techNameMap.get(tech) || tech} → $${stats.productionValue.toFixed(2)}`);
    }

    // ── Step 5: Process 30-day-only routes → completion stats ──
    const thirtyDayOnly = thirtyDayRoutes.filter(r => !weekRouteIDs.has(r.routeID));
    for (const route of thirtyDayOnly) {
      const stats = await getRouteStats(route.routeID, cfg.key, cfg.token, rl);
      if (!stats) continue;
      const tech = route.assignedTech;

      const prev = techThirtyDay.get(tech) || { completed: 0, pending: 0, noShow: 0 };
      techThirtyDay.set(tech, {
        completed: prev.completed + stats.completed,
        pending:   prev.pending   + stats.pending,
        noShow:    prev.noShow    + stats.noShow,
      });

      log.push(`30d route ${route.routeID} (${route.date}) ${techNameMap.get(tech) || tech}`);
    }

    // ── Step 6: Build results + upsert to DB ──
    const results: any[] = [];
    let upserted = 0;

    // Load PMP techs for this office from DB
    const pmpTechs = await prisma.technician.findMany({
      where: { office: officeFilter, team: 'PMP', status: 'ACTIVE', frEmployeeId: { not: null } },
    });
    const frIdToTech = new Map(pmpTechs.map(t => [String(t.frEmployeeId), t]));

    for (const techID of allTechIDs) {
      const techName    = techNameMap.get(techID) || `Tech ${techID}`;
      const production  = techWeekProduction.get(techID) || 0;
      const thirtyD     = techThirtyDay.get(techID) || { completed: 0, pending: 0, noShow: 0 };
      const total30d    = thirtyD.completed + thirtyD.pending + thirtyD.noShow;
      const completionRate = total30d > 0 ? thirtyD.completed / total30d : null;

      results.push({
        techID,
        techName,
        completionPct: completionRate !== null ? parseFloat((completionRate * 100).toFixed(1)) : null,
        productionValue: parseFloat(production.toFixed(2)),
        completed30d: thirtyD.completed,
        pending30d:   thirtyD.pending,
        noShow30d:    thirtyD.noShow,
        total30d,
      });

      log.push(`${techName}: completion=${completionRate !== null ? (completionRate * 100).toFixed(1) + '%' : '—'} | production=$${production.toFixed(2)}`);

      // Upsert to DB if this tech is a known PMP tech
      const dbTech = frIdToTech.get(techID);
      if (dbTech) {
        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId: dbTech.techId, weekEnd } },
        });

        const updateData: any = {
          completionPct:   completionRate,
          productionValue: production,
          updatedAt:       new Date(),
        };

        if (existing) {
          await prisma.techWeek.update({
            where: { techId_weekEnd: { techId: dbTech.techId, weekEnd } },
            data: updateData,
          });
        } else {
          await prisma.techWeek.create({
            data: {
              id:              crypto.randomUUID(),
              technicianId:    dbTech.id,
              techId:          dbTech.techId,
              weekEnd,
              office:          officeFilter,
              team:            'PMP',
              siteLeader:      dbTech.siteLeader,
              crewLeader:      dbTech.crewLeader,
              completionPct:   completionRate,
              productionValue: production,
              manualAdj:       0,
            },
          });
        }
        upserted++;
      }
    }

    results.sort((a, b) => b.productionValue - a.productionValue);

    return NextResponse.json({
      status: 'success',
      office: officeFilter,
      weekEnd: weekEndStr,
      weekStart: weekStartStr,
      thirtyDayStart: thirtyDayStartStr,
      techsUpserted: upserted,
      results,
      log: log.join('\n'),
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    log.push(`Error: ${e.message}`);
    return NextResponse.json({
      status: 'error',
      error: e.message,
      log: log.join('\n'),
    }, { status: 500 });
  }
}
