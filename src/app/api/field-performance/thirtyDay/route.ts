export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!   },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!   },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!   },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
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
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`FR HTTP ${res.status}`);
    return res.json();
  };
}

async function getRouteCompletionOnly(routeID: string, key: string, token: string, rl: (u: string) => Promise<any>) {
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

  return {
    completed: appointments.filter(a => a.status === '1').length,
    pending:   appointments.filter(a => a.status === '0').length,
    noShow:    appointments.filter(a => a.statusText === 'No Show').length,
  };
}

async function getRoutesForDateRange(dateStart: string, dateEnd: string, key: string, token: string, rl: (u: string) => Promise<any>) {
  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;
  const routeSearch = await rl(`${BASE_URL}/route/search?${auth}`);
  const allRouteIDs: string[] = routeSearch.routeIDs || [];
  const recentIDs = allRouteIDs.slice(-1000);
  const matching: Array<{ routeID: string; date: string; assignedTech: string }> = [];

  for (let i = 0; i < recentIDs.length; i += 100) {
    const batch = recentIDs.slice(i, i + 100).join(',');
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
    weekEnd.setDate(weekEnd.getDate() - weekEnd.getDay());
  }
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6);
  const thirtyDayStart = new Date(weekEnd);
  thirtyDayStart.setDate(weekEnd.getDate() - 30); // gives 5/13

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const weekStartStr      = fmt(weekStart);
  const weekEndStr        = fmt(weekEnd);
  const thirtyDayStartStr = fmt(thirtyDayStart);

  const log: string[] = [
    `Office: ${officeFilter}`,
    `Week: ${weekStartStr} → ${weekEndStr}`,
    `30-day: ${thirtyDayStartStr} → ${weekEndStr}`,
  ];
  const rl = makeRateLimiter();

  try {
    // ── Get both route sets ──
    log.push('Fetching week routes (to exclude from 30-day)...');
    const weekRoutes = await getRoutesForDateRange(weekStartStr, weekEndStr, cfg.key, cfg.token, rl);
    const weekRouteIDs = new Set(weekRoutes.map(r => r.routeID));
    log.push(`Week routes: ${weekRoutes.length}`);

    log.push('Fetching 30-day routes...');
    const thirtyDayRoutes = await getRoutesForDateRange(thirtyDayStartStr, weekEndStr, cfg.key, cfg.token, rl);
    const thirtyDayOnly = thirtyDayRoutes.filter(r => !weekRouteIDs.has(r.routeID));
    log.push(`30-day extra routes (excl. week): ${thirtyDayOnly.length}`);

    // ── Resolve tech names ──
    const allTechIDs = [...new Set([
      ...weekRoutes.map(r => r.assignedTech),
      ...thirtyDayOnly.map(r => r.assignedTech),
    ])];
    const techNameMap = new Map<string, string>();
    if (allTechIDs.length) {
      const auth = `&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
      const empData = await rl(`${BASE_URL}/employee/get?employeeIDs=${allTechIDs.join(',')}${auth}`);
      (empData.employees || []).forEach((e: any) => {
        techNameMap.set(String(e.employeeID), `${e.fname} ${e.lname}`.trim());
      });
    }

    // ── Accumulate completion stats ──
    // Start with week routes (already processed for production, but need completion too)
    const techCompletion = new Map<string, { completed: number; pending: number; noShow: number }>();

    log.push('Processing week routes for completion...');
    for (const route of weekRoutes) {
      const stats = await getRouteCompletionOnly(route.routeID, cfg.key, cfg.token, rl);
      if (!stats) continue;
      const tech = route.assignedTech;
      const prev = techCompletion.get(tech) || { completed: 0, pending: 0, noShow: 0 };
      techCompletion.set(tech, {
        completed: prev.completed + stats.completed,
        pending:   prev.pending   + stats.pending,
        noShow:    prev.noShow    + stats.noShow,
      });
    }

    log.push('Processing 30-day extra routes for completion...');
    for (const route of thirtyDayOnly) {
      const stats = await getRouteCompletionOnly(route.routeID, cfg.key, cfg.token, rl);
      if (!stats) continue;
      const tech = route.assignedTech;
      const name = techNameMap.get(tech) || tech;
      const prev = techCompletion.get(tech) || { completed: 0, pending: 0, noShow: 0 };
      techCompletion.set(tech, {
        completed: prev.completed + stats.completed,
        pending:   prev.pending   + stats.pending,
        noShow:    prev.noShow    + stats.noShow,
      });
      log.push(`30d route ${route.routeID} (${route.date}) ${name}`);
    }

    // ── Load PMP techs + upsert completion % to DB ──
    const pmpTechs = await prisma.technician.findMany({
      where: { office: officeFilter, team: 'PMP', status: 'ACTIVE', frEmployeeId: { not: null } },
    });
    const frIdToTech = new Map(pmpTechs.map(t => [String(t.frEmployeeId), t]));
    let upserted = 0;

    const results: any[] = [];
    for (const techID of allTechIDs) {
      const techName = techNameMap.get(techID) || `Tech ${techID}`;
      const comp     = techCompletion.get(techID) || { completed: 0, pending: 0, noShow: 0 };
      const total    = comp.completed + comp.pending + comp.noShow;
      const completionPct = total > 0 ? comp.completed / total : null;

      results.push({
        techID,
        techName,
        completionPct: completionPct !== null ? parseFloat((completionPct * 100).toFixed(1)) : null,
        ...comp,
        total,
      });

      log.push(`${techName}: ${completionPct !== null ? (completionPct * 100).toFixed(1) + '%' : '—'} completion`);

      const dbTech = frIdToTech.get(techID);
      if (dbTech) {
        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId: dbTech.techId, weekEnd } },
        });
        if (existing) {
          await prisma.techWeek.update({
            where: { techId_weekEnd: { techId: dbTech.techId, weekEnd } },
            data: { completionPct, updatedAt: new Date() },
          });
        } else {
          await prisma.techWeek.create({
            data: {
              id:           crypto.randomUUID(),
              technicianId: dbTech.id,
              techId:       dbTech.techId,
              weekEnd,
              office:       officeFilter,
              team:         'PMP',
              siteLeader:   dbTech.siteLeader,
              crewLeader:   dbTech.crewLeader,
              completionPct,
              manualAdj:    0,
            },
          });
        }
        upserted++;
      }
    }

    return NextResponse.json({
      status:    'success',
      step:      'thirtyDay',
      office:    officeFilter,
      weekEnd:   weekEndStr,
      thirtyDayStart: thirtyDayStartStr,
      routesProcessed: weekRoutes.length + thirtyDayOnly.length,
      techsUpserted:   upserted,
      results,
      log: log.join('\n'),
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    log.push(`Error: ${e.message}`);
    return NextResponse.json({ status: 'error', error: e.message, log: log.join('\n') }, { status: 500 });
  }
}
