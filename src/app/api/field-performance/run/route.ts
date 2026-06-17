// src/app/api/field-performance/run/route.ts
// Syncs reservice rate + revEff for PMP techs
// Production value and 30-day completion% handled by /api/field-performance/production

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const SUBDOMAIN = 'critterstoppest';
const BASE_URL = `https://${SUBDOMAIN}.fieldroutes.com/api`;

const OFFICES: Record<string, { key: string; token: string; officeId: number; reserviceTypeIds: Set<string> }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1, reserviceTypeIds: new Set(['3'])           },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5, reserviceTypeIds: new Set(['3'])           },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3, reserviceTypeIds: new Set(['3'])           },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4, reserviceTypeIds: new Set(['822','821','807','732']) },
};

const PROD_STANDARD_PER_DAY = 5676.92;

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
      const items = Array.isArray(data[propName]) ? data[propName] : Object.values(data[propName] as object);
      results.push(...items);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }

function getMostRecentFriday(offsetWeeks = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysToFri = day >= 5 ? day - 5 : day + 2;
  d.setDate(d.getDate() - daysToFri - offsetWeeks * 7);
  return d;
}

async function pullReservices(
  cfg: { key: string; token: string; officeId: number; reserviceTypeIds: Set<string> },
  weekStart: Date,
  weekEnd: Date,
  pmpTechs: Map<number, string>
): Promise<Map<string, number>> {

  const result = new Map<string, number>();
  const RESERVICE_TYPES = cfg.reserviceTypeIds;
  const LOOKBACK_DAYS = 90;

  const lookbackStart = new Date(weekEnd);
  lookbackStart.setDate(lookbackStart.getDate() - LOOKBACK_DAYS);

  let searchData: any;
  try {
    const searchUrl = frUrl('appointment', 'search', {
      officeIDs: String(cfg.officeId),
      dateStart: fmtDate(lookbackStart),
      dateEnd: fmtDate(weekEnd),
    }, cfg.key, cfg.token);
    searchData = await frFetch(searchUrl);
  } catch { return result; }

  const apptIds: number[] = searchData.appointmentIDs || [];
  if (apptIds.length === 0) return result;

  const allAppts = await fetchInBatches('appointment', 'get', 'appointmentIDs', apptIds, cfg.key, cfg.token);

  const weekStartMs = weekStart.getTime();
  const weekEndMs   = weekEnd.getTime() + 86400000;

  const reservicesThisWeek = allAppts.filter((a: any) => {
    const typeStr = String(a.type || a.serviceTypeID || '');
    const dateMs  = a.date ? new Date(a.date).getTime() : 0;
    return RESERVICE_TYPES.has(typeStr) && String(a.status) === '1' && dateMs >= weekStartMs && dateMs <= weekEndMs;
  });

  const regularAppts = allAppts.filter((a: any) => {
    const typeStr = String(a.type || a.serviceTypeID || '');
    return !RESERVICE_TYPES.has(typeStr) && String(a.status) === '1';
  });

  const customerAppts = new Map<string, any[]>();
  for (const appt of regularAppts) {
    const custId = String(appt.customerID || '');
    if (!custId) continue;
    if (!customerAppts.has(custId)) customerAppts.set(custId, []);
    customerAppts.get(custId)!.push(appt);
  }
  for (const [, appts] of customerAppts) {
    appts.sort((a: any, b: any) => {
      const aDate = a.date ? new Date(a.date).getTime() : 0;
      const bDate = b.date ? new Date(b.date).getTime() : 0;
      return bDate - aDate;
    });
  }

  const reseviceCountByTech = new Map<string, number>();
  for (const rs of reservicesThisWeek) {
    const custId = String(rs.customerID || '');
    if (!custId || custId === '0') continue;
    const rsDateMs = rs.date ? new Date(rs.date).getTime() : 0;
    const history  = customerAppts.get(custId) || [];
    if (history.length === 0) continue;
    const lastRegular = history.find((a: any) => {
      const aDate = a.date ? new Date(a.date).getTime() : 0;
      return aDate < rsDateMs;
    });
    if (!lastRegular) continue;
    const empId = parseInt(lastRegular.servicedBy || lastRegular.employeeID || '0');
    if (!empId || !pmpTechs.has(empId)) continue;
    const techId = pmpTechs.get(empId) as string | undefined;
    if (!techId) continue;
    reseviceCountByTech.set(techId, (reseviceCountByTech.get(techId) ?? 0) + 1);
  }

  const NUMBER_OF_TIME_PERIODS = 90 / 6;
  const threeMonthsAgoMs = weekEnd.getTime() - (3 * 30 * 24 * 60 * 60 * 1000);
  const regularCountByTech = new Map<string, number>();
  for (const appt of regularAppts) {
    const dateMs = appt.date ? new Date(appt.date).getTime() : 0;
    if (dateMs < threeMonthsAgoMs) continue;
    const empId = parseInt(appt.servicedBy || appt.employeeID || '0');
    if (!empId || !pmpTechs.has(empId)) continue;
    const techId = pmpTechs.get(empId)!;
    regularCountByTech.set(techId, (regularCountByTech.get(techId) ?? 0) + 1);
  }
  for (const [techId, count] of regularCountByTech) {
    regularCountByTech.set(techId, count / NUMBER_OF_TIME_PERIODS);
  }
  for (const [techId, rsCount] of reseviceCountByTech) {
    const regularCount = regularCountByTech.get(techId) ?? 0;
    if (regularCount > 0) result.set(techId, rsCount / regularCount);
  }

  return result;
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
    const pmpTechs = new Map(officeTechs.filter(t => t.team === 'PMP').map(t => [t.frEmployeeId!, t.techId]));

    if (pmpTechs.size === 0) { log.push(`  No PMP techs`); continue; }

    try {
      // Fetch routes for routeCount (needed for revEff)
      const routeSearchUrl = frUrl('route', 'search', {
        officeIDs: String(cfg.officeId),
        dateStart: fmtDate(weekStart),
        dateEnd: fmtDate(weekEnd),
      }, cfg.key, cfg.token);
      const routeSearch = await frFetch(routeSearchUrl);
      const routeIds: number[] = routeSearch.routeIDs || [];
      const routeCountByTech = new Map<string, number>();
      if (routeIds.length > 0) {
        const routes = await fetchInBatches('route', 'get', 'routeIDs', routeIds, cfg.key, cfg.token);
        for (const route of routes) {
          const empId = parseInt(route.assignedTech || '0');
          if (!empId || !pmpTechs.has(empId)) continue;
          const techId = pmpTechs.get(empId) as string | undefined;
          if (!techId) continue;
          routeCountByTech.set(techId, (routeCountByTech.get(techId) ?? 0) + 1);
        }
      }
      log.push(`  Routes: ${routeIds.length}`);

      // Reservice rate
      const pmpReserviceMap = new Map<string, number>();
      try {
        const rsMap = await pullReservices(cfg, weekStart, weekEnd, pmpTechs);
        for (const [k, v] of rsMap) pmpReserviceMap.set(k, v);
        log.push(`  Reservice: ${[...pmpReserviceMap.entries()].map(([k,v]) => `${k}=${(v*100).toFixed(1)}%`).join(', ') || 'none'}`);
      } catch (e: any) {
        log.push(`  Reservice error: ${e.message}`);
      }

      // Upsert: reservice + revEff (revEff uses productionValue from DB)
      for (const tech of officeTechs.filter(t => t.team === 'PMP')) {
        const reseviceRate = pmpReserviceMap.get(tech.techId) ?? 0;
        const routeCount   = routeCountByTech.get(tech.techId) ?? 0;

        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
        });

        const productionValue = existing?.productionValue ?? 0;
        const hrDays = tech.hrDays || 8;
        const revenueEff = productionValue > 0 && routeCount > 0
          ? Math.min((productionValue / routeCount / hrDays * 40) / PROD_STANDARD_PER_DAY, 1.1)
          : null;

        const updateData: any = { reseviceRate, updatedAt: new Date() };
        if (revenueEff !== null) updateData.revenueEfficiency = revenueEff;

        const completionPct = existing?.completionPct ?? null;
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
              reseviceRate,
              revenueEfficiency: revenueEff,
              manualAdj: 0,
            },
          });
        }

        updated++;
        log.push(`  ${tech.techId} ${tech.name}: revEff=${revenueEff !== null ? (revenueEff*100).toFixed(0)+'%' : '—'}, reservice=${(reseviceRate*100).toFixed(1)}%`);
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
    techsUpdated: updated,
    executedAt: new Date().toISOString(),
    errors,
    log: log.join('\n'),
  }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
}
