// src/app/api/field-performance/routeCustomers/route.ts
// Pre-fetches FR route appointments for the week, extracts customer coords per tech PER DAY,
// and caches them for the reliability cron.
//
// Cache key: rc_customers_<office>_<date> (one per day, not per week)
// This ensures each day only matches customers scheduled for THAT day.
//
// Usage: /api/field-performance/routeCustomers?token=critterstop2026&weekEnd=YYYY-MM-DD&office=DFW
// Run once per office per week (saves 5 daily cache keys internally)

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

async function getRouteCustomerIds(
  routeID: string, key: string, token: string,
  rl: (u: string) => Promise<any>
): Promise<Array<{ customerId: string; frAppointmentId: string }>> {
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
  const results: Array<{ customerId: string; frAppointmentId: string }> = [];
  (apptData.appointments || []).forEach((a: any) => {
    if (a.customerID && a.customerID !== '0') {
      results.push({
        customerId: String(a.customerID),
        frAppointmentId: String(a.appointmentID || a.id),
      });
    }
  });
  return results;
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
    const officeTechs = await prisma.technician.findMany({
      where: { office: officeFilter, status: 'ACTIVE', frEmployeeId: { not: null } },
      select: { techId: true, frEmployeeId: true, name: true },
    });
    const frIdToTechId = new Map<string, string>(
      officeTechs.map(t => [String(t.frEmployeeId), t.techId])
    );
    log.push(`Loaded ${officeTechs.length} active techs for ${officeFilter}`);

    log.push('Fetching routes...');
    const allRoutes = await getRoutesForDateRange(weekStartStr, weekEndStr, cfg.key, cfg.token, rl);
    const offriceFrIds = new Set(officeTechs.map(t => String(t.frEmployeeId)));
    const officeRoutes = allRoutes.filter(r => offriceFrIds.has(r.assignedTech));
    const chunk = officeRoutes.slice(offset, offset + limit);
    log.push(`Found ${officeRoutes.length} routes for ${officeFilter} (filtered from ${allRoutes.length} total)`);
    log.push(`Processing chunk ${offset}–${offset + chunk.length - 1} of ${officeRoutes.length}`);

    // Process each route — group by date AND tech
    // techDateAppts: date → techId → Map<customerId, frAppointmentId>
    const techDateAppts = new Map<string, Map<string, Map<string, string>>>();

    for (const route of chunk) {
      const techId = frIdToTechId.get(route.assignedTech);
      if (!techId) continue;

      const appts = await getRouteCustomerIds(route.routeID, cfg.key, cfg.token, rl);
      const date = route.date; // e.g. "2026-06-08"

      if (!techDateAppts.has(date)) techDateAppts.set(date, new Map());
      const dateMap = techDateAppts.get(date)!;
      if (!dateMap.has(techId)) dateMap.set(techId, new Map());
      for (const { customerId, frAppointmentId } of appts) {
        dateMap.get(techId)!.set(customerId, frAppointmentId);
      }
    }
    log.push(`Collected routes for ${techDateAppts.size} days`);

    // Geocode all unique customers across all days
    const allCustomerIds = [...new Set(
      [...techDateAppts.values()].flatMap(dateMap =>
        [...dateMap.values()].flatMap(custMap => [...custMap.keys()])
      )
    )];
    log.push(`Total unique customers: ${allCustomerIds.length}`);

    const geocoded = await prisma.customer.findMany({
      where: { externalId: { in: allCustomerIds }, lat: { not: null }, lng: { not: null } },
      select: { externalId: true, lat: true, lng: true },
    });
    const coordMap = new Map<string, { lat: number; lng: number }>(
      geocoded.map(c => [c.externalId!, { lat: c.lat!, lng: c.lng! }])
    );
    log.push(`Geocoded ${coordMap.size} of ${allCustomerIds.length} customers`);

    // Save one cache key per day: rc_customers_<office>_<date>
    for (const [date, dateMap] of techDateAppts) {
      const cacheKey = `rc_customers_${officeFilter}_${date}`;

      const techCoordsMap: Record<string, Array<{ lat: number; lng: number; customerId: string; frAppointmentId: string }>> = {};
      for (const [techId, custApptMap] of dateMap) {
        const entries: Array<{ lat: number; lng: number; customerId: string; frAppointmentId: string }> = [];
        for (const [customerId, frAppointmentId] of custApptMap) {
          const coord = coordMap.get(customerId);
          if (coord) entries.push({ ...coord, customerId, frAppointmentId });
        }
        if (entries.length > 0) techCoordsMap[techId] = entries;
      }

      // Merge with existing or reset
      let existingMap: Record<string, Array<{ lat: number; lng: number; customerId: string; frAppointmentId: string }>> = {};
      if (!reset) {
        try {
          const existing = await prisma.appSetting.findUnique({ where: { key: cacheKey } });
          if (existing?.value) existingMap = JSON.parse(existing.value);
        } catch {}
      }

      for (const [techId, entries] of Object.entries(techCoordsMap)) {
        if (!existingMap[techId]) {
          existingMap[techId] = entries;
        } else {
          const existingApptIds = new Set(existingMap[techId].map(e => e.frAppointmentId));
          for (const entry of entries) {
            if (!existingApptIds.has(entry.frAppointmentId)) {
              existingMap[techId].push(entry);
              existingApptIds.add(entry.frAppointmentId);
            }
          }
        }
      }

      await prisma.appSetting.upsert({
        where:  { key: cacheKey },
        update: { value: JSON.stringify(existingMap) },
        create: { key: cacheKey, value: JSON.stringify(existingMap) },
      });

      log.push(`Saved ${cacheKey}: ${Object.keys(existingMap).length} techs, ${Object.values(existingMap).reduce((s, v) => s + v.length, 0)} customers`);
    }

    return NextResponse.json({
      status: 'success',
      weekEnd: weekEndStr,
      office: officeFilter,
      offset,
      limit,
      totalRoutes: officeRoutes.length,
      daysProcessed: techDateAppts.size,
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
