// src/app/api/field-performance/routeCustomers/route.ts
// Pre-fetches FR route appointments for the week, extracts customer coords per tech,
// and caches them for the reliability cron.
//
// Uses the SAME logic as thirtyDayA - just fetches for the current week, all techs.
// Run BEFORE reliability cron each week, per office.
//
// Usage: /api/field-performance/routeCustomers?token=critterstop2026&weekEnd=YYYY-MM-DD&office=DFW
// Cache key: rc_customers_<office>_<weekEnd>

export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
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

// Same as thirtyDayA - get routes for date range
async function getRoutesForDateRange(
  dateStart: string, dateEnd: string,
  key: string, token: string,
  rl: (u: string) => Promise<any>
) {
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

// Get customerIDs from a route via spots → appointments
async function getRouteCustomerIds(
  routeID: string, key: string, token: string,
  rl: (u: string) => Promise<any>
): Promise<string[]> {
  const auth = `&authenticationKey=${key}&authenticationToken=${token}`;
  const spotSearch = await rl(`${BASE_URL}/spot/search?routeID=${routeID}${auth}`);
  const spotIDs: string[] = spotSearch.spotIDs || [];
  if (!spotIDs.length) return [];

  const spotData = await rl(`${BASE_URL}/spot/get?spotIDs=${spotIDs.join(',')}${auth}`);
  const apptIDs: string[] = [];
  (spotData.spots || []).forEach((s: any) => {
    if (s.appointmentIDs?.length) apptIDs.push(...s.appointmentIDs);
  });
  if (!apptIDs.length) return [];

  const apptData = await rl(`${BASE_URL}/appointment/get?appointmentIDs=${apptIDs.join(',')}${auth}`);
  const customerIds: string[] = [];
  (apptData.appointments || []).forEach((a: any) => {
    if (a.customerID && a.customerID !== '0') customerIds.push(String(a.customerID));
  });
  return [...new Set(customerIds)];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const officeFilter = searchParams.get('office') || 'DFW';
  const weekEndParam = searchParams.get('weekEnd');
  const offset = parseInt(searchParams.get('offset') || '0');
  const limit  = parseInt(searchParams.get('limit')  || '30');
  const reset  = searchParams.get('reset') === 'true';
  const cfg = OFFICES[officeFilter];
  if (!cfg?.key) return NextResponse.json({ error: `Unknown office: ${officeFilter}` }, { status: 400 });

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const weekEnd = weekEndParam
    ? new Date(weekEndParam + 'T00:00:00.000Z')
    : new Date();
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6);

  const weekEndStr   = fmt(weekEnd);
  const weekStartStr = fmt(weekStart);

  const log: string[] = [`Office: ${officeFilter}`, `Week: ${weekStartStr} → ${weekEndStr}`];
  const rl = makeRateLimiter();
  const errors: string[] = [];

  try {
    // Load ALL active techs for this office to map assignedTech → techId
    const officeTechs = await prisma.technician.findMany({
      where: { office: officeFilter, status: 'ACTIVE', frEmployeeId: { not: null } },
      select: { techId: true, frEmployeeId: true, name: true },
    });
    // assignedTech on route is a string frEmployeeId
    const frIdToTechId = new Map<string, string>(
      officeTechs.map(t => [String(t.frEmployeeId), t.techId])
    );
    log.push(`Loaded ${officeTechs.length} active techs for ${officeFilter}`);

    // Fetch routes for the week — same as thirtyDayA
    log.push('Fetching routes...');
    const allRoutes = await getRoutesForDateRange(weekStartStr, weekEndStr, cfg.key, cfg.token, rl);
    // Filter to only routes assigned to our office techs
    const offriceFrIds = new Set(officeTechs.map(t => String(t.frEmployeeId)));
    const officeRoutes = allRoutes.filter(r => offriceFrIds.has(r.assignedTech));
    const chunk = officeRoutes.slice(offset, offset + limit);
    log.push(`Found ${officeRoutes.length} routes for ${officeFilter} (filtered from ${allRoutes.length} total)`);
    log.push(`Processing chunk ${offset}–${offset + chunk.length - 1} of ${officeRoutes.length}`);

    // Process each route — get customer IDs
    const techCustomerIds = new Map<string, Set<string>>(); // techId → Set<customerId>

    for (const route of chunk) {
      const techId = frIdToTechId.get(route.assignedTech);
      if (!techId) continue;

      const customerIds = await getRouteCustomerIds(route.routeID, cfg.key, cfg.token, rl);
      if (!techCustomerIds.has(techId)) techCustomerIds.set(techId, new Set());
      for (const cid of customerIds) techCustomerIds.get(techId)!.add(cid);
    }
    log.push(`Collected customer IDs for ${techCustomerIds.size} techs`);

    // Look up geocoded coords for all collected customer IDs
    const allCustomerIds = [...new Set([...techCustomerIds.values()].flatMap(s => [...s]))];
    log.push(`Total unique customers: ${allCustomerIds.length}`);

    const geocoded = await prisma.customer.findMany({
      where: { externalId: { in: allCustomerIds }, lat: { not: null }, lng: { not: null } },
      select: { externalId: true, lat: true, lng: true },
    });
    const coordMap = new Map<string, { lat: number; lng: number }>(
      geocoded.map(c => [c.externalId!, { lat: c.lat!, lng: c.lng! }])
    );
    log.push(`Geocoded ${coordMap.size} of ${allCustomerIds.length} customers`);

    // Build final techId → coords map
    const techCoordsMap: Record<string, Array<{ lat: number; lng: number }>> = {};
    for (const [techId, custIds] of techCustomerIds) {
      const coords = [...custIds].map(id => coordMap.get(id)).filter(Boolean) as Array<{ lat: number; lng: number }>;
      if (coords.length > 0) {
        techCoordsMap[techId] = coords;
        log.push(`  ${techId}: ${coords.length} route customers`);
      }
    }

    // Save to AppSetting cache (merge with existing, or reset if reset=true)
    const cacheKey = `rc_customers_${officeFilter}_${weekEndStr}`;
    let existingMap: Record<string, Array<{ lat: number; lng: number }>> = {};
    if (reset) {
      log.push(`Cache reset requested — starting fresh for ${officeFilter}`);
    } else {
      try {
        const existing = await prisma.appSetting.findUnique({ where: { key: cacheKey } });
        if (existing?.value) existingMap = JSON.parse(existing.value);
      } catch {}
    }

    // Merge
    for (const [techId, coords] of Object.entries(techCoordsMap)) {
      if (existingMap[techId]) {
        const seen = new Set(existingMap[techId].map((c: any) => `${c.lat},${c.lng}`));
        for (const c of coords) {
          if (!seen.has(`${c.lat},${c.lng}`)) { existingMap[techId].push(c); seen.add(`${c.lat},${c.lng}`); }
        }
      } else {
        existingMap[techId] = coords;
      }
    }

    await prisma.appSetting.upsert({
      where:  { key: cacheKey },
      update: { value: JSON.stringify(existingMap) },
      create: { key: cacheKey, value: JSON.stringify(existingMap) },
    });

    log.push(`Saved cache → key: ${cacheKey}, techs: ${Object.keys(existingMap).length}`);

    return NextResponse.json({
      status: 'success',
      weekEnd: weekEndStr,
      office: officeFilter,
      offset,
      limit,
      totalRoutes: officeRoutes.length,
      techsMapped: Object.keys(existingMap).length,
      errors,
      log: log.join('\n'),
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    errors.push(e.message);
    return NextResponse.json({
      status: 'error', weekEnd: weekEndStr, office: officeFilter, errors, log: log.join('\n'),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
