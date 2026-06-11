// src/app/api/cron/field-performance/route.ts
// Weekly cron: pulls Route Reporting + Tech Reservices from FieldRoutes
// and upserts into tech_weeks for PMP techs.
// Run every Friday night after routes close.

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

// Standard production rate per hr-day (used for revenue efficiency)
const PROD_STANDARD_PER_DAY = 1150; // $1,150/day standard

function frUrl(endpoint: string, action: string, params: Record<string, string>, key: string, token: string) {
  const url = new URL(`${BASE_URL}/${endpoint}/${action}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('authenticationKey', key);
  url.searchParams.set('authenticationToken', token);
  return url.toString();
}

async function frFetch(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`FR HTTP ${res.status}: ${url}`);
  return res.json();
}

// Get Friday-ending week dates
function getWeekDates(weekEnd: Date) {
  const end = new Date(weekEnd);
  end.setHours(23, 59, 59, 999);
  const start = new Date(weekEnd);
  start.setDate(start.getDate() - 6); // previous Saturday
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0];
}

// ─── ROUTE REPORTING ────────────────────────────────────────────────────────
// Pulls from: Reporting -> Route Reporting in FR UI
// API: appointment/search by date + officeId, then appointment/get
async function pullRouteReporting(
  office: string,
  cfg: { key: string; token: string; officeId: number },
  weekStart: Date,
  weekEnd: Date
): Promise<Map<number, { totalScheduled: number; completed: number; productionValue: number; days: number }>> {

  const result = new Map<number, { totalScheduled: number; completed: number; productionValue: number; days: number }>();

  // Search for appointment IDs in date range for this office
  const searchUrl = frUrl('appointment', 'search', {
    officeIDs: String(cfg.officeId),
    dateStart: fmtDate(weekStart),
    dateEnd: fmtDate(weekEnd),
  }, cfg.key, cfg.token);

  const searchData = await frFetch(searchUrl);
  const apptIds: number[] = searchData.appointmentIDs || [];

  if (apptIds.length === 0) return result;

  // Fetch in batches of 100
  for (let i = 0; i < apptIds.length; i += 100) {
    const batch = apptIds.slice(i, i + 100);
    const getUrl = frUrl('appointment', 'get', {
      appointmentIDs: batch.join(','),
    }, cfg.key, cfg.token);

    const data = await frFetch(getUrl);
    const appts = Array.isArray(data.appointments)
      ? data.appointments
      : Object.values(data.appointments || {});

    for (const appt of appts) {
      const empId = parseInt(appt.employeeID || appt.technicianID || '0');
      if (!empId) continue;

      // Only count assigned (not unassigned) routes
      const status = String(appt.status || '');
      const isCompleted = status === '1' || status === 'Completed';
      const isScheduled = isCompleted || status === '0' || status === 'Pending';
      if (!isScheduled) continue;

      const prodValue = parseFloat(appt.total || appt.serviceTotal || '0');
      const apptDate = appt.date || appt.start || '';

      if (!result.has(empId)) {
        result.set(empId, { totalScheduled: 0, completed: 0, productionValue: 0, days: 0 });
      }
      const entry = result.get(empId)!;
      entry.totalScheduled++;
      if (isCompleted) {
        entry.completed++;
        entry.productionValue += prodValue;
      }
      // Track unique days worked
      if (apptDate) {
        const dateKey = apptDate.split(' ')[0];
        // We'll count days separately below
      }
    }
  }

  return result;
}

// ─── TECH RESERVICES ────────────────────────────────────────────────────────
// Pulls from: Reporting -> Tech Reservices in FR UI
// API: reservice/search by date range
async function pullReservices(
  office: string,
  cfg: { key: string; token: string; officeId: number },
  weekStart: Date,
  weekEnd: Date
): Promise<Map<number, { totalReservices: number; avgServiced: number; reserviceRate: number }>> {

  const result = new Map<number, { totalReservices: number; avgServiced: number; reserviceRate: number }>();

  const searchUrl = frUrl('reservice', 'search', {
    officeIDs: String(cfg.officeId),
    dateStart: fmtDate(weekStart),
    dateEnd: fmtDate(weekEnd),
  }, cfg.key, cfg.token);

  let searchData: any;
  try {
    searchData = await frFetch(searchUrl);
  } catch (e) {
    // reservice endpoint may not exist on all offices
    return result;
  }

  const reserviceIds: number[] = searchData.reserviceIDs || searchData.reServiceIDs || [];
  if (reserviceIds.length === 0) return result;

  for (let i = 0; i < reserviceIds.length; i += 100) {
    const batch = reserviceIds.slice(i, i + 100);
    const getUrl = frUrl('reservice', 'get', {
      reserviceIDs: batch.join(','),
    }, cfg.key, cfg.token);

    let data: any;
    try {
      data = await frFetch(getUrl);
    } catch {
      continue;
    }

    const reservices = Array.isArray(data.reservices)
      ? data.reservices
      : Object.values(data.reservices || {});

    for (const rs of reservices) {
      const empId = parseInt(rs.employeeID || rs.technicianID || '0');
      if (!empId) continue;

      if (!result.has(empId)) {
        result.set(empId, { totalReservices: 0, avgServiced: 0, reserviceRate: 0 });
      }
      result.get(empId)!.totalReservices++;
    }
  }

  // Calculate reservice rates — need total serviced per tech for the period
  // We'll use a rolling 30-day window from appointments for avg serviced
  // For now store raw counts; rate calculated when we have appointment counts
  return result;
}

// ─── MAIN SYNC ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Default to most recent Friday; allow override via body.weekEnd
  const weekEnd = body.weekEnd ? new Date(body.weekEnd + 'T00:00:00.000Z') : (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const daysToFri = day >= 5 ? day - 5 : day + 2;
    d.setDate(d.getDate() - daysToFri);
    return d;
  })();

  const { start: weekStart } = getWeekDates(weekEnd);

  // Load all active techs with FR employee IDs
  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE', frEmployeeId: { not: null } },
  });

  const empToTech = new Map(techs.map(t => [t.frEmployeeId!, t]));

  const log: string[] = [`Week: ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}`];
  let updated = 0;
  const errors: string[] = [];

  for (const [officeName, cfg] of Object.entries(OFFICES)) {
    if (!cfg.key || !cfg.token) {
      log.push(`${officeName}: skipped (no API key)`);
      continue;
    }

    log.push(`\n--- ${officeName} ---`);

    try {
      // Pull route reporting
      const routes = await pullRouteReporting(officeName, cfg, weekStart, weekEnd);
      log.push(`${officeName}: ${routes.size} techs with route data`);

      // Pull reservices
      const reservices = await pullReservices(officeName, cfg, weekStart, weekEnd);
      log.push(`${officeName}: ${reservices.size} techs with reservice data`);

      // Get office techs
      const officeTechs = techs.filter(t => t.office === officeName && t.frEmployeeId);

      for (const tech of officeTechs) {
        const empId = tech.frEmployeeId!;
        const routeData = routes.get(empId);
        const resData = reservices.get(empId);

        if (!routeData && !resData) continue;

        // Calculate metrics
        let completionPct: number | null = null;
        let revenueEfficiency: number | null = null;
        let productionValue: number | null = null;
        let reseviceRate: number | null = null;

        if (routeData && routeData.totalScheduled > 0) {
          completionPct = routeData.completed / routeData.totalScheduled;
          productionValue = routeData.productionValue;

          // Revenue efficiency: actual production / standard (days × $1150)
          // Use hrDays to determine standard days in week
          const stdDays = tech.hrDays === 10 ? 4 : 5;
          const stdProduction = stdDays * PROD_STANDARD_PER_DAY;
          revenueEfficiency = stdProduction > 0 ? Math.min(routeData.productionValue / stdProduction, 1.1) : null;
        }

        if (resData && routeData && routeData.completed > 0) {
          // Reservice rate = reservices / avg serviced per period
          // avg serviced = completed jobs in rolling window (use this week as proxy)
          reseviceRate = resData.totalReservices / routeData.completed;
        } else if (resData) {
          reseviceRate = resData.totalReservices > 0 ? resData.totalReservices / 1 : 0;
        }

        // Upsert into tech_weeks — only update PMP-relevant fields
        // Scoring will be recalculated when all data is present
        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
        });

        const updateData: any = { updatedAt: new Date() };
        if (completionPct !== null) updateData.completionPct = completionPct;
        if (revenueEfficiency !== null) updateData.revenueEfficiency = revenueEfficiency;
        if (productionValue !== null) updateData.productionValue = productionValue;
        if (reseviceRate !== null) updateData.reseviceRate = reseviceRate;

        // Recalculate PMP score if we have enough data
        if (tech.team === 'PMP' && existing &&
            revenueEfficiency !== null && reseviceRate !== null &&
            existing.drivingScore !== null && existing.reliabilityScore !== null) {
          const pmpScore =
            revenueEfficiency * 0.35 +
            (0.95 + 0.10 - reseviceRate) * 0.20 +
            (1 - (0.95 - (completionPct ?? 0.95)) * 5) * 0.20 +
            existing.drivingScore * 0.10 +
            existing.reliabilityScore * 0.15;
          updateData.pmpScore = pmpScore;
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
              siteLeader: tech.siteLeader,
              crewLeader: tech.crewLeader,
              completionPct,
              revenueEfficiency,
              productionValue,
              reseviceRate,
              manualAdj: 0,
            },
          });
        }

        updated++;
        log.push(`  ${tech.techId} (${tech.name}): completion=${completionPct?.toFixed(2) ?? '—'}, revEff=${revenueEfficiency?.toFixed(2) ?? '—'}, reservice=${reseviceRate?.toFixed(3) ?? '—'}`);
      }

    } catch (e: any) {
      const msg = `${officeName} error: ${e.message}`;
      errors.push(msg);
      log.push(msg);
    }
  }

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    weekEnd: fmtDate(weekEnd),
    weekStart: fmtDate(weekStart),
    techsUpdated: updated,
    errors,
    log: log.join('\n'),
  });
}

// Allow manual trigger via GET for testing
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return POST(req);
}
