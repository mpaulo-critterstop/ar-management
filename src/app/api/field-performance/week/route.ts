export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

const OFFICES: Record<string, { key: string; token: string; officeId: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: '1' },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: '5' },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: '3' },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: '4' },
};

function makeRateLimiter() {
  let callCount = 0;
  let minuteStart = Date.now();
  return async function rl(url: string): Promise<any> {
    if (Date.now() - minuteStart > 60000) { callCount = 0; minuteStart = Date.now(); }
    if (callCount >= 55) {
      const wait = 60000 - (Date.now() - minuteStart) + 1000;
      await new Promise(r => setTimeout(r, wait));
      callCount = 0; minuteStart = Date.now();
    }
    callCount++;

    // Retry transient failures (502/503/504 gateway errors, timeouts) with exponential backoff
    const MAX_RETRIES = 3;
    let lastErr: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
        if (res.ok) return res.json();
        // Rate-limit (429) or gateway errors → retry; other 4xx → fail fast
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`FR HTTP ${res.status}`);
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt))); // 2s, 4s, 8s
            continue;
          }
        }
        throw new Error(`FR HTTP ${res.status}`);
      } catch (e: any) {
        lastErr = e;
        // Timeout / network error → retry
        if (attempt < MAX_RETRIES && (e.name === 'TimeoutError' || e.name === 'AbortError' || String(e.message).includes('FR HTTP 5') || String(e.message).includes('fetch'))) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  };
}

async function getRouteStats(routeID: string, key: string, token: string, rl: (u: string) => Promise<any>) {
  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;
  const spotSearch = await rl(`${BASE_URL}/spot/search?routeID=${routeID}${auth}`);
  const spotIDs: string[] = spotSearch.spotIDs || [];
  if (!spotIDs.length) return null;

  const spotData = await rl(`${BASE_URL}/spot/get?spotIDs=${spotIDs.join(',')}${auth}`);
  const apptIDs: string[] = [];
  (spotData.spots || []).forEach((s: any) => { if (s.appointmentIDs?.length) apptIDs.push(...s.appointmentIDs); });
  if (!apptIDs.length) return null;

  const apptData = await rl(`${BASE_URL}/appointment/get?appointmentIDs=${apptIDs.join(',')}${auth}`);
  const appointments: any[] = apptData.appointments || [];
  const completed = appointments.filter(a => a.status === '1').length;
  const pending   = appointments.filter(a => a.status === '0').length;
  const noShow    = appointments.filter(a => a.statusText === 'No Show').length;
  const validAppts = appointments.filter(a => a.status !== '-1');

  const subIDs = [...new Set(validAppts.map((a: any) => a.subscriptionID).filter((s: any) => parseInt(s) > 0))];
  const subMap = new Map<string, { value: number; recurring: number; recurringTicketPV: number }>();
  if (subIDs.length) {
    const subData = await rl(`${BASE_URL}/subscription/get?subscriptionIDs=${subIDs.join(',')}${auth}`);
    (subData.subscriptions || []).forEach((s: any) => {
      const recurringTicketPV = parseFloat(s.recurringTicket?.productionValue || 0);
      const recurring = parseFloat(s.recurringCharge || 0);
      const initial   = parseFloat(s.initialServiceTotal || 0);
      let value = recurringTicketPV > 0 ? recurringTicketPV : recurring > 0 ? recurring : initial;
      subMap.set(String(s.subscriptionID), { value, recurring, recurringTicketPV });
    });
  }

  const ticketIDs = [...new Set(validAppts.map((a: any) => a.ticketID).filter((t: any) => t && t !== '0'))];
  const ticketMap = new Map<string, number>();
  if (ticketIDs.length) {
    const ticketData = await rl(`${BASE_URL}/ticket/get?ticketIDs=${ticketIDs.join(',')}${auth}`);
    (ticketData.tickets || []).forEach((t: any) => ticketMap.set(String(t.ticketID), parseFloat(t.subTotal || 0)));
  }

  let productionValue = 0;
  for (const a of validAppts) {
    const isNoShow  = a.statusText === 'No Show';
    const hasSub    = parseInt(a.subscriptionID) > 0;
    const subInfo   = subMap.get(String(a.subscriptionID));
    const hasTicket = a.ticketID && a.ticketID !== '0';
    const ticketAmt = hasTicket ? (ticketMap.get(String(a.ticketID)) || 0) : null;

    if (isNoShow) {
      if (hasSub && subInfo && subInfo.recurring > 0) productionValue += subInfo.recurring;
      else if (hasTicket && ticketAmt && ticketAmt > 0) productionValue += ticketAmt;
    } else {
      if (hasTicket) {
        if (ticketAmt && ticketAmt > 0) productionValue += ticketAmt;
        else if (hasSub && subInfo && subInfo.recurringTicketPV > 0) productionValue += subInfo.recurringTicketPV;
      } else if (hasSub && subInfo) {
        productionValue += subInfo.value;
      }
    }
  }

  return { routeID, completed, pending, noShow, productionValue };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getRoutesForDateRange(dateStart: string, dateEnd: string, key: string, token: string, rl: (u: string) => Promise<any>, officeId?: string) {
  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;
  const officeParam = officeId ? `officeIDs=${officeId}&` : '';
  const routeSearch = await rl(`${BASE_URL}/route/search?${officeParam}dateStart=${dateStart}&dateEnd=${dateEnd}${auth}`);
  const allRouteIDs: string[] = routeSearch.routeIDs || [];
  const matching: Array<{ routeID: string; date: string; assignedTech: string }> = [];

  for (let i = 0; i < allRouteIDs.length; i += 100) {
    const batch = allRouteIDs.slice(i, i + 100).join(',');
    const routeData = await rl(`${BASE_URL}/route/get?routeIDs=${batch}${auth}`);
    (routeData.routes || []).forEach((r: any) => {
      if (r.date >= dateStart && r.date <= dateEnd && r.assignedTech && r.assignedTech !== '0') {
        matching.push({ routeID: String(r.routeID), date: r.date, assignedTech: String(r.assignedTech) });
      }
    });
  }
  return matching;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const officeFilter = searchParams.get('office') || 'CStat';
  const weekEndParam = searchParams.get('weekEnd');
  const cfg = OFFICES[officeFilter];
  if (!cfg?.key) return NextResponse.json({ error: `Unknown or unconfigured office: ${officeFilter}` }, { status: 400 });

  let weekEnd: Date;
  if (weekEndParam) {
    weekEnd = new Date(weekEndParam + 'T00:00:00.000Z');
  } else {
    weekEnd = new Date();
    weekEnd.setHours(0, 0, 0, 0);
    weekEnd.setDate(weekEnd.getDate() - weekEnd.getDay()); // last Sunday
  }
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const weekStartStr = fmt(weekStart);
  const weekEndStr   = fmt(weekEnd);

  const log: string[] = [`Week: ${weekStartStr} → ${weekEndStr}`, `Office: ${officeFilter}`];
  const rl = makeRateLimiter();

  try {
    // ── Find week routes ──
    log.push('Fetching week routes...');
    const weekRoutes = await getRoutesForDateRange(weekStartStr, weekEndStr, cfg.key, cfg.token, rl, cfg.officeId);
    log.push(`Found ${weekRoutes.length} week routes`);

    // ── Load PMP techs + filter routes to PMP only ──
    const pmpTechs = await prisma.technician.findMany({
      where: { office: officeFilter, team: 'PMP', status: 'ACTIVE', frEmployeeId: { not: null } },
    });
    const frIdToTech = new Map(pmpTechs.map(t => [String(t.frEmployeeId), t]));
    const pmpFrIds = new Set(pmpTechs.map(t => String(t.frEmployeeId)));
    const pmpWeekRoutes = weekRoutes.filter(r => pmpFrIds.has(r.assignedTech));
    log.push(`PMP routes: ${pmpWeekRoutes.length} (filtered from ${weekRoutes.length} total)`);

    // ── Resolve tech names ──
    const techIDs = [...new Set(pmpWeekRoutes.map(r => r.assignedTech))];
    const techNameMap = new Map<string, string>();
    if (techIDs.length) {
      const auth = `&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
      const empData = await rl(`${BASE_URL}/employee/get?employeeIDs=${techIDs.join(',')}${auth}`);
      (empData.employees || []).forEach((e: any) => {
        techNameMap.set(String(e.employeeID), `${e.fname} ${e.lname}`.trim());
      });
    }

    // ── Process all PMP routes in parallel (concurrent spot searches) ──
    const techProduction = new Map<string, number>();
    const techCompletion = new Map<string, { completed: number; pending: number; noShow: number }>();

    // Also collect per-route data for tech_routes table
    const routeRows: Array<{
      techId: string; frRouteId: string; date: string;
      completed: number; pending: number; noShow: number; productionValue: number;
    }> = [];

    // Run routes concurrently in small groups. Each route = 3-5 FR calls, so keep the group
    // small enough that a burst (group × 5) stays well under FR's 60/min ceiling. 5×5=25 worst case.
    const CONCURRENCY = 5;
    for (let i = 0; i < pmpWeekRoutes.length; i += CONCURRENCY) {
      const batch = pmpWeekRoutes.slice(i, i + CONCURRENCY);
      const batchStats = await Promise.all(batch.map(r => getRouteStats(r.routeID, cfg.key, cfg.token, rl)));
      for (let j = 0; j < batch.length; j++) {
        const route = batch[j];
        const stats = batchStats[j];
        if (!stats) continue;
        const tech = route.assignedTech;
        const dbTech = frIdToTech.get(tech);
        const name = techNameMap.get(tech) || tech;
        techProduction.set(tech, (techProduction.get(tech) || 0) + stats.productionValue);
        const prev = techCompletion.get(tech) || { completed: 0, pending: 0, noShow: 0 };
        techCompletion.set(tech, {
          completed: prev.completed + stats.completed,
          pending:   prev.pending   + stats.pending,
          noShow:    prev.noShow    + stats.noShow,
        });
        log.push(`Route ${route.routeID} (${route.date}) ${name} → $${stats.productionValue.toFixed(2)}`);
        // Save per-route row if tech is in DB
        if (dbTech) {
          routeRows.push({
            techId:         dbTech.techId,
            frRouteId:      route.routeID,
            date:           route.date,
            completed:      stats.completed,
            pending:        stats.pending,
            noShow:         stats.noShow,
            productionValue: stats.productionValue,
          });
        }
      }
    }

    // ── Upsert per-route rows into tech_routes ──
    for (const row of routeRows) {
      const dateObj = new Date(row.date + 'T12:00:00.000Z');
      await prisma.$executeRaw`
        INSERT INTO tech_routes ("id","techId","frRouteId","date","weekEnd","office","completed","pending","noShow","productionValue","createdAt","updatedAt")
        VALUES (
          ${crypto.randomUUID()}, ${row.techId}, ${row.frRouteId}, ${dateObj}, ${weekEnd},
          ${officeFilter}, ${row.completed}, ${row.pending}, ${row.noShow}, ${row.productionValue},
          NOW(), NOW()
        )
        ON CONFLICT ("techId","frRouteId") DO UPDATE SET
          "completed"=${row.completed}, "pending"=${row.pending}, "noShow"=${row.noShow},
          "productionValue"=${row.productionValue}, "weekEnd"=${weekEnd}, "updatedAt"=NOW()
      `;
    }
    log.push(`Saved ${routeRows.length} route rows to tech_routes`);

    let upserted = 0;

    const results: any[] = [];
    for (const techID of techIDs) {
      const techName   = techNameMap.get(techID) || `Tech ${techID}`;
      const production = techProduction.get(techID) || 0;
      const comp       = techCompletion.get(techID) || { completed: 0, pending: 0, noShow: 0 };

      results.push({ techID, techName, production, ...comp });
      log.push(`${techName}: $${production.toFixed(2)} production`);

      const dbTech = frIdToTech.get(techID);
      if (dbTech) {
        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId: dbTech.techId, weekEnd } },
        });
        if (existing) {
          await prisma.techWeek.update({
            where: { techId_weekEnd: { techId: dbTech.techId, weekEnd } },
            data: { productionValue: production, updatedAt: new Date() },
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
              productionValue: production,
              manualAdj:       0,
            },
          });
        }
        upserted++;
      }
    }

    return NextResponse.json({
      status:    'success',
      step:      'week',
      office:    officeFilter,
      weekStart: weekStartStr,
      weekEnd:   weekEndStr,
      routesProcessed: weekRoutes.length,
      techsUpserted:   upserted,
      results,
      log: log.join('\n'),
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    log.push(`Error: ${e.message}`);
    return NextResponse.json({ status: 'error', error: e.message, log: log.join('\n') }, { status: 500 });
  }
}
