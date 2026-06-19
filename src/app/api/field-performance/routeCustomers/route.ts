// src/app/api/field-performance/routeCustomers/route.ts
// Pre-fetches FR route appointments for the week, extracts customer coords per tech,
// and stores them in AppSetting cache for use by the reliability cron.
//
// Run this BEFORE the reliability cron each week.
// Usage: /api/field-performance/routeCustomers?token=critterstop2026&weekEnd=YYYY-MM-DD&office=DFW
//
// Cache key: rc_customers_<office>_<weekEnd>  e.g. rc_customers_DFW_2026-06-12
// Cache value: JSON map of { [techId: string]: Array<{ lat: number; lng: number }> }

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const FR_SUBDOMAIN = 'critterstoppest';
const FR_BASE      = `https://${FR_SUBDOMAIN}.fieldroutes.com/api`;
const FR_OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

function frUrl(endpoint: string, action: string, params: Record<string, string>, key: string, token: string) {
  const url = new URL(`${FR_BASE}/${endpoint}/${action}`);
  url.searchParams.set('authenticationKey', key);
  url.searchParams.set('authenticationToken', token);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function frFetch(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FR fetch failed: ${res.status}`);
  return res.json();
}

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token   = searchParams.get('token');
  const weekEndStr = searchParams.get('weekEnd');
  const officeFilter = searchParams.get('office');

  if (token !== process.env.CRON_SECRET && token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!weekEndStr) {
    return NextResponse.json({ error: 'weekEnd required' }, { status: 400 });
  }

  const weekEnd   = new Date(weekEndStr + 'T12:00:00.000Z');
  const weekStart = new Date(weekEnd.getTime() - 6 * 24 * 60 * 60 * 1000);

  const log: string[] = [];
  const errors: string[] = [];
  const results: Record<string, number> = {}; // office → techs mapped

  const officesToProcess = officeFilter
    ? [officeFilter]
    : Object.keys(FR_OFFICES);

  for (const officeName of officesToProcess) {
    const cfg = FR_OFFICES[officeName];
    if (!cfg) {
      errors.push(`Unknown office: ${officeName}`);
      continue;
    }

    try {
      log.push(`\n--- ${officeName} ---`);

      // 1. Fetch all routes for this office/week
      const routeSearchUrl = frUrl('route', 'search', {
        officeIDs:  String(cfg.officeId),
        dateStart:  fmtDate(weekStart),
        dateEnd:    fmtDate(weekEnd),
      }, cfg.key, cfg.token);
      const routeSearchData = await frFetch(routeSearchUrl);
      const allRouteIds: number[] = routeSearchData.routeIDs || [];
      log.push(`Found ${allRouteIds.length} routes`);

      if (allRouteIds.length === 0) continue;

      // 2. Fetch route details in batches of 100 to get assignedTech + appointmentIDs
      const allRoutes: any[] = [];
      for (let i = 0; i < allRouteIds.length; i += 100) {
        const batch = allRouteIds.slice(i, i + 100);
        const rd = await frFetch(frUrl('route', 'get', { routeIDs: batch.join(',') }, cfg.key, cfg.token));
        allRoutes.push(...(rd.routes || []));
        if (i + 100 < allRouteIds.length) await new Promise(r => setTimeout(r, 300));
      }
      log.push(`Fetched ${allRoutes.length} route details`);

      // 3. Group appointment IDs by assignedTech (FR employee ID)
      const empApptIds = new Map<number, Set<number>>();
      for (const route of allRoutes) {
        const empId = parseInt(route.assignedTech || route.technicianID || '0');
        if (!empId) continue;
        if (!empApptIds.has(empId)) empApptIds.set(empId, new Set());
        // FR routes store appointments inside spots
        for (const spot of (route.spots || [])) {
          for (const apptId of (spot.appointmentIDs || [])) {
            empApptIds.get(empId)!.add(apptId);
          }
        }
        // Also check direct appointmentIDs just in case
        for (const apptId of (route.appointmentIDs || [])) {
          empApptIds.get(empId)!.add(apptId);
        }
      }
      log.push(`Grouped appointments for ${empApptIds.size} techs`);

      // 4. Fetch appointment details to get customerIDs
      const allApptIds = [...new Set([...empApptIds.values()].flatMap(s => [...s]))];
      const apptCustomerMap = new Map<number, string>(); // apptId → customerId

      for (let i = 0; i < allApptIds.length; i += 200) {
        const batch = allApptIds.slice(i, i + 200);
        const apptData = await frFetch(frUrl('appointment', 'get', { appointmentIDs: batch.join(',') }, cfg.key, cfg.token));
        for (const appt of (apptData.appointments || [])) {
          if (appt.customerID) apptCustomerMap.set(appt.appointmentID || appt.id, String(appt.customerID));
        }
        if (i + 200 < allApptIds.length) await new Promise(r => setTimeout(r, 300));
      }
      log.push(`Fetched customer IDs for ${apptCustomerMap.size} appointments`);

      // 5. Get unique customerIDs and look up their geocoded coords from DB
      const allCustomerIds = [...new Set(apptCustomerMap.values())];
      const geocodedCustomers = await prisma.customer.findMany({
        where: { externalId: { in: allCustomerIds }, lat: { not: null }, lng: { not: null } },
        select: { externalId: true, lat: true, lng: true },
      });
      const custCoordMap = new Map<string, { lat: number; lng: number }>(geocodedCustomers.map(c => [c.externalId!, { lat: c.lat!, lng: c.lng! }]));
      log.push(`Geocoded ${custCoordMap.size} of ${allCustomerIds.length} customers`);

      // 6. Build per-tech customer coord map, keyed by techId (our internal ID)
      // Need to map FR employeeID → our techId via technicians table
      const officeTechs = await prisma.technician.findMany({
        where: { office: officeName, status: 'ACTIVE', frEmployeeId: { not: null } },
        select: { techId: true, frEmployeeId: true, name: true },
      });
      const frEmpToTechId = new Map<number, string>(officeTechs.map(t => [t.frEmployeeId!, t.techId]));

      const techCoordsMap: Record<string, Array<{ lat: number; lng: number }>> = {};
      for (const [empId, apptIds] of empApptIds) {
        const techId = frEmpToTechId.get(empId);
        if (!techId) continue;

        const coords: Array<{ lat: number; lng: number }> = [];
        const seen = new Set<string>();
        for (const apptId of apptIds) {
          const custId = apptCustomerMap.get(apptId);
          if (!custId || seen.has(custId)) continue;
          seen.add(custId);
          const coord = custCoordMap.get(custId);
          if (coord) coords.push(coord);
        }
        if (coords.length > 0) {
          techCoordsMap[techId] = coords;
          log.push(`  ${techId}: ${coords.length} route customers`);
        }
      }

      // 7. Save to AppSetting cache
      const cacheKey = `rc_customers_${officeName}_${weekEndStr}`;
      await prisma.appSetting.upsert({
        where:  { key: cacheKey },
        update: { value: JSON.stringify(techCoordsMap) },
        create: { key: cacheKey, value: JSON.stringify(techCoordsMap) },
      });

      results[officeName] = Object.keys(techCoordsMap).length;
      log.push(`Saved cache for ${officeName}: ${Object.keys(techCoordsMap).length} techs → key: ${cacheKey}`);

    } catch (e: any) {
      const msg = `${officeName} error: ${e.message}`;
      errors.push(msg);
      log.push(msg);
    }
  }

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    weekEnd: weekEndStr,
    offices: results,
    errors,
    log: log.join('\n'),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
