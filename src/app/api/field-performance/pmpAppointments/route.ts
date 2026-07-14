// src/app/api/field-performance/pmpAppointments/route.ts
// Populates the pmp_appointments rolling 90-day window used by reservice rate attribution.
//
// Normal weekly run: fetches only the current week's completed appointments and upserts them,
// then prunes rows older than 100 days (small buffer past the 90-day window).
//
// Initial seed: pass &backfill=true to fetch the full trailing 90 days in one shot
// (one heavy FR pull, done once per office).
//
// Usage:
//   weekly:   /api/field-performance/pmpAppointments?token=critterstop2026&office=DFW&weekEnd=2026-07-10
//   backfill: /api/field-performance/pmpAppointments?token=critterstop2026&office=DFW&weekEnd=2026-07-10&backfill=true

export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

const OFFICES: Record<string, { key: string; token: string; officeId: number; reserviceTypeIds: Set<string> }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1, reserviceTypeIds: new Set(['3','1005','1066']) },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5, reserviceTypeIds: new Set(['3','1005','1066']) },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3, reserviceTypeIds: new Set(['3','1005','1066']) },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4, reserviceTypeIds: new Set(['3','822','821','807','732','809','1005','1066']) },
};

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

async function fetchInBatches(endpoint: string, action: string, idParam: string, ids: any[], key: string, token: string, delayMs = 400): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const url = frUrl(endpoint, action, { [idParam]: batch.join(',') }, key, token);
    try {
      const data = await frFetch(url);
      // Extract the appointments array specifically (avoid picking up empty ignoredParams etc.)
      const arr = data.appointments || data[action + 's'] || null;
      if (Array.isArray(arr)) {
        results.push(...arr);
      } else {
        // fallback: largest non-meta array
        const candidates = Object.entries(data)
          .filter(([k, v]) => Array.isArray(v) && !['ignoredParams', 'appointmentIDs'].includes(k))
          .sort((a: any, b: any) => b[1].length - a[1].length);
        if (candidates.length) results.push(...(candidates[0][1] as any[]));
      }
    } catch (e) {
      // skip failed batch
    }
    if (i + 100 < ids.length) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}

function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const officeFilter = searchParams.get('office') || 'DFW';
  const weekEndParam = searchParams.get('weekEnd');
  const backfill = searchParams.get('backfill') === 'true';
  const cfg = OFFICES[officeFilter];
  if (!cfg?.key) return NextResponse.json({ error: `Unknown office: ${officeFilter}` }, { status: 400 });

  let weekEnd: Date;
  if (weekEndParam) {
    weekEnd = new Date(weekEndParam + 'T00:00:00.000Z');
  } else {
    weekEnd = new Date();
    weekEnd.setHours(0, 0, 0, 0);
    weekEnd.setDate(weekEnd.getDate() - weekEnd.getDay());
  }

  // Fetch window: full 90 days on backfill, otherwise just the current week
  const fetchStart = new Date(weekEnd);
  if (backfill) {
    fetchStart.setDate(weekEnd.getDate() - 90);
  } else {
    fetchStart.setDate(weekEnd.getDate() - 6); // current week (Sat→Fri)
  }

  const log: string[] = [
    `Office: ${officeFilter}`,
    `Mode: ${backfill ? 'BACKFILL (90d)' : 'weekly (7d)'}`,
    `Fetch window: ${fmtDate(fetchStart)} → ${fmtDate(weekEnd)}`,
  ];

  try {
    // Search completed appointments in the window
    const searchUrl = frUrl('appointment', 'search', {
      officeIDs: String(cfg.officeId),
      dateStart: fmtDate(fetchStart),
      dateEnd:   fmtDate(weekEnd),
    }, cfg.key, cfg.token);
    const searchData = await frFetch(searchUrl);
    const apptIds: number[] = searchData.appointmentIDs || [];
    log.push(`Found ${apptIds.length} appointment IDs`);

    if (apptIds.length === 0) {
      return NextResponse.json({
        status: 'success', office: officeFilter, weekEnd: fmtDate(weekEnd),
        fetched: 0, upserted: 0, pruned: 0, log: log.join('\n'),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const allAppts = await fetchInBatches('appointment', 'get', 'appointmentIDs', apptIds, cfg.key, cfg.token, 500);
    log.push(`Fetched ${allAppts.length} appointment records`);

    // Store only completed appointments (status='1') — reservice logic only uses completed
    let upserted = 0;
    for (const a of allAppts) {
      if (String(a.status) !== '1') continue;
      const custId = String(a.customerID || '');
      if (!custId || custId === '0') continue;

      const typeStr = String(a.type || a.serviceTypeID || '');
      const isReservice = cfg.reserviceTypeIds.has(typeStr);
      const dateObj = a.date ? new Date(a.date) : null;
      if (!dateObj) continue;
      const empId = parseInt(a.servicedBy || a.employeeID || '0') || null;

      await prisma.$executeRaw`
        INSERT INTO pmp_appointments
          ("id","frAppointmentId","office","date","serviceTypeId","isReservice","status","customerId","frEmployeeId","createdAt","updatedAt")
        VALUES (
          ${crypto.randomUUID()}, ${String(a.appointmentID)}, ${officeFilter}, ${dateObj},
          ${typeStr}, ${isReservice}, ${'1'}, ${custId}, ${empId}, NOW(), NOW()
        )
        ON CONFLICT ("frAppointmentId") DO UPDATE SET
          "date"=${dateObj}, "serviceTypeId"=${typeStr}, "isReservice"=${isReservice},
          "status"=${'1'}, "customerId"=${custId}, "frEmployeeId"=${empId}, "updatedAt"=NOW()
      `;
      upserted++;
    }
    log.push(`Upserted ${upserted} completed appointments`);

    // Prune rows older than 100 days (buffer past the 90-day attribution window)
    const pruneCutoff = new Date(weekEnd);
    pruneCutoff.setDate(weekEnd.getDate() - 100);
    const pruned = await prisma.$executeRaw`
      DELETE FROM pmp_appointments WHERE "office"=${officeFilter} AND "date" < ${pruneCutoff}
    `;
    log.push(`Pruned ${pruned} rows older than ${fmtDate(pruneCutoff)}`);

    return NextResponse.json({
      status: 'success', office: officeFilter, weekEnd: fmtDate(weekEnd),
      mode: backfill ? 'backfill' : 'weekly',
      fetched: allAppts.length, upserted, pruned,
      log: log.join('\n'),
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    log.push(`Error: ${e.message}`);
    return NextResponse.json({ status: 'error', error: e.message, log: log.join('\n') }, { status: 500 });
  }
}
