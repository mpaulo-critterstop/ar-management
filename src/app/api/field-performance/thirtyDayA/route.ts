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
  const routeSearch = await rl(`${BASE_URL}/route/search?dateStart=${dateStart}&dateEnd=${dateEnd}${auth}`);
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
  const rangeStartParam = searchParams.get('rangeStart');
  const rangeEndParam   = searchParams.get('rangeEnd');
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

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const weekEndStr = fmt(weekEnd);

  // Use override params if provided, otherwise default to days 1-15
  const rangeEnd = rangeEndParam
    ? new Date(rangeEndParam + 'T00:00:00.000Z')
    : new Date(weekEnd);

  const rangeStart = rangeStartParam
    ? new Date(rangeStartParam + 'T00:00:00.000Z')
    : (() => { const d = new Date(weekEnd); d.setDate(weekEnd.getDate() - 14); return d; })();

  const rangeStartStr = fmt(rangeStart);
  const rangeEndStr   = fmt(rangeEnd);

  const log: string[] = [
    `Office: ${officeFilter}`,
    `thirtyDayA range: ${rangeStartStr} → ${rangeEndStr} (days 1-15)`,
  ];
  const rl = makeRateLimiter();

  try {
    // Load PMP techs to filter routes
    const pmpTechs = await prisma.technician.findMany({
      where: { office: officeFilter, team: 'PMP', status: 'ACTIVE', frEmployeeId: { not: null } },
    });
    const pmpFrIds = new Set(pmpTechs.map(t => String(t.frEmployeeId)));

    log.push('Fetching routes...');
    const allRoutes = await getRoutesForDateRange(rangeStartStr, rangeEndStr, cfg.key, cfg.token, rl);
    const routes = allRoutes.filter(r => pmpFrIds.has(r.assignedTech));
    log.push(`Found ${routes.length} PMP routes (filtered from ${allRoutes.length} total)`);

    // Resolve tech names
    const techIDs = [...new Set(routes.map(r => r.assignedTech))];
    const techNameMap = new Map<string, string>();
    if (techIDs.length) {
      const auth = `&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
      const empData = await rl(`${BASE_URL}/employee/get?employeeIDs=${techIDs.join(',')}${auth}`);
      (empData.employees || []).forEach((e: any) => {
        techNameMap.set(String(e.employeeID), `${e.fname} ${e.lname}`.trim());
      });
    }

    // Process routes
    const techCompletion = new Map<string, { completed: number; pending: number; noShow: number }>();

    for (const route of routes) {
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
      log.push(`Route ${route.routeID} (${route.date}) ${name}`);
    }

    // ── Save/merge counts to AppSetting cache for thirtyDayB ──
    const cacheKey = `fp_30da_${officeFilter}_${weekEndStr}`;

    // Load existing cache if present (DFW calls thirtyDayA twice)
    let existingCounts: Record<string, { completed: number; pending: number; noShow: number }> = {};
    try {
      const existing = await prisma.appSetting.findUnique({ where: { key: cacheKey } });
      if (existing) existingCounts = JSON.parse(existing.value);
    } catch {}

    // Merge new counts on top of existing
    const mergedCounts: Record<string, { completed: number; pending: number; noShow: number }> = { ...existingCounts };
    for (const techID of techIDs) {
      const fresh = techCompletion.get(techID) || { completed: 0, pending: 0, noShow: 0 };
      const prev  = existingCounts[techID]     || { completed: 0, pending: 0, noShow: 0 };
      mergedCounts[techID] = {
        completed: prev.completed + fresh.completed,
        pending:   prev.pending   + fresh.pending,
        noShow:    prev.noShow    + fresh.noShow,
      };
    }

    await prisma.appSetting.upsert({
      where:  { key: cacheKey },
      update: { value: JSON.stringify(mergedCounts) },
      create: { key: cacheKey, value: JSON.stringify(mergedCounts) },
    });
    log.push(`Saved/merged cache for ${Object.keys(mergedCounts).length} techs → key: ${cacheKey}`);

    const results = techIDs.map(techID => ({
      techID,
      techName: techNameMap.get(techID) || `Tech ${techID}`,
      ...techCompletion.get(techID) || { completed: 0, pending: 0, noShow: 0 },
    }));

    return NextResponse.json({
      status:          'success',
      step:            'thirtyDayA',
      office:          officeFilter,
      weekEnd:         weekEndStr,
      rangeStart:      fmt(rangeStart),
      rangeEnd:        fmt(rangeEnd),
      routesProcessed: routes.length,
      results,
      log: log.join('\n'),
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    log.push(`Error: ${e.message}`);
    return NextResponse.json({ status: 'error', error: e.message, log: log.join('\n') }, { status: 500 });
  }
}
