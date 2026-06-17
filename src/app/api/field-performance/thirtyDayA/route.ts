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

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const weekEndStr = fmt(weekEnd);

  // thirtyDayA: days 1-15 (5/28 - 6/12)
  // /week handles current week (6/6-6/12) for production
  // thirtyDayA handles full first 15 days for completion
  const rangeEnd   = new Date(weekEnd);                          // 6/12
  const rangeStart = new Date(weekEnd);
  rangeStart.setDate(weekEnd.getDate() - 14);                    // 5/29

  const rangeStartStr = fmt(rangeStart);
  const rangeEndStr   = fmt(rangeEnd);

  const log: string[] = [
    `Office: ${officeFilter}`,
    `thirtyDayA range: ${rangeStartStr} → ${rangeEndStr} (days 1-15)`,
  ];
  const rl = makeRateLimiter();

  try {
    log.push('Fetching routes...');
    const routes = await getRoutesForDateRange(rangeStartStr, rangeEndStr, cfg.key, cfg.token, rl);
    log.push(`Found ${routes.length} routes`);

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

    // Save counts to AppSetting cache for thirtyDayB to read
    const cacheKey = `fp_30da_${officeFilter}_${weekEndStr}`;
    const cacheData: Record<string, { completed: number; pending: number; noShow: number }> = {};
    for (const techID of techIDs) {
      cacheData[techID] = techCompletion.get(techID) || { completed: 0, pending: 0, noShow: 0 };
    }
    await prisma.appSetting.upsert({
      where:  { key: cacheKey },
      update: { value: JSON.stringify(cacheData) },
      create: { key: cacheKey, value: JSON.stringify(cacheData) },
    });
    log.push(`Saved cache for ${Object.keys(cacheData).length} techs → key: ${cacheKey}`);

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
      rangeStart:      rangeStartStr,
      rangeEnd:        rangeEndStr,
      routesProcessed: routes.length,
      results,
      log: log.join('\n'),
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    log.push(`Error: ${e.message}`);
    return NextResponse.json({ status: 'error', error: e.message, log: log.join('\n') }, { status: 500 });
  }
}
