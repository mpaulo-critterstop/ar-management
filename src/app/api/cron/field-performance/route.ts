// src/app/api/cron/field-performance/route.ts
// Weekly cron: pulls WP close-out%, callback rate, PMP route reporting + reservices
// Run every Sunday 12am CST via cron-job.org

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

// ─── APPOINTMENT TYPE IDs ────────────────────────────────────────────────────
const TRAP_CHECK_TYPES       = new Set(['504', '636']);
const EXCLUSION_TYPES        = new Set(['553', '716']);
const CALLBACK_TYPES         = new Set(['615', '671', '546', '554']);
const CALLBACK_TC_TYPES      = new Set(['620']);
const ANNUAL_INSP_TYPES      = new Set(['533']);
const ANNUAL_INSP_TC_TYPES   = new Set(['538']);

// Close-out keywords (same as dispatcher)
const CLOSEOUT_KEYWORDS = ['ready for insulation', 'ready for far', 'closed out'];

// Standard production rate per hr-day for PMP revenue efficiency
const PROD_STANDARD_PER_DAY = 1150;

// ─── HELPERS ────────────────────────────────────────────────────────────────
function frUrl(endpoint: string, action: string, params: Record<string, string>, key: string, token: string) {
  const url = new URL(`${BASE_URL}/${endpoint}/${action}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('authenticationKey', key);
  url.searchParams.set('authenticationToken', token);
  return url.toString();
}

async function frFetch(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`FR HTTP ${res.status}`);
  return res.json();
}

async function fetchInBatches(endpoint: string, action: string, idParam: string, ids: any[], key: string, token: string): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const url = frUrl(endpoint, action, { [idParam]: batch.join(',') }, key, token);
    const data = await frFetch(url);
    // FR returns the data key name in the 'propertyName' field
    const propName = data.propertyName;
    if (data.success && propName && data[propName]) {
      const items = Array.isArray(data[propName])
        ? data[propName]
        : Object.values(data[propName] as object);
      results.push(...items);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  return results;
}

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function hasCloseoutNote(appt: any): boolean {
  const text = [appt.officeNotes, appt.techNotes]
    .filter(Boolean).join(' ').toLowerCase();
  return CLOSEOUT_KEYWORDS.some(k => text.includes(k));
}

function getMostRecentFriday(offsetWeeks = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysToFri = day >= 5 ? day - 5 : day + 2;
  d.setDate(d.getDate() - daysToFri - offsetWeeks * 7);
  return d;
}

// ─── WP: CLOSE-OUT % + CALLBACK RATE ────────────────────────────────────────
// Close-out opportunities:
//   - TC #2+ (trap check where customer has >= 2 TCs after exclusion)
//   - Call Back (615, 671, 546, 554) — opportunity itself
//   - Call Back Trap Check (620)
//   - Annual Inspection (533)
//   - Annual Inspection Trap Check (538)
// Close-out = appointment has close-out note in tech/office notes
// Callback rate = CB appointments / jobs 60-120 days ago (handled separately)

interface TechWPStats {
  closeoutOpportunities: number;  // CO window: total jobs
  closeouts: number;               // CO window: closed out jobs
  callbacks: number;               // CB window: total jobs
  callbackCount: number;           // CB window: jobs with future CBs
}

async function pullWPMetrics(
  cfg: { key: string; token: string; officeId: number },
  weekStart: Date,
  weekEnd: Date,
  wpTechs: Map<number, string>
): Promise<Map<string, TechWPStats>> {

  const result = new Map<string, TechWPStats>();
  const initStats = (): TechWPStats => ({ closeoutOpportunities: 0, closeouts: 0, callbacks: 0, callbackCount: 0 });

  // CO%: use tc_appointments from 15-45 days ago (Excel formula: AD/AE)
  const coEnd   = new Date(weekEnd); coEnd.setDate(coEnd.getDate() - 15);
  const coStart = new Date(weekEnd); coStart.setDate(coStart.getDate() - 45);

  // CB Rate: use tc_appointments from 60-120 days ago (Excel formula: AH/AG)
  const cbEnd   = new Date(weekEnd); cbEnd.setDate(cbEnd.getDate() - 60);
  const cbStart = new Date(weekEnd); cbStart.setDate(cbStart.getDate() - 120);

  // Build techId set for this office's WP techs
  const wpTechIds = new Set([...wpTechs.values()]);

  // Fetch CO window appointments from DB
  const coAppts = await prisma.tcAppointment.findMany({
    where: {
      techId: { in: [...wpTechIds] },
      date: { gte: coStart, lte: coEnd },
    },
    select: { techId: true, closedOut: true, wk1CloseOut: true },
  });

  // Fetch CB window appointments from DB
  const cbAppts = await prisma.tcAppointment.findMany({
    where: {
      techId: { in: [...wpTechIds] },
      date: { gte: cbStart, lte: cbEnd },
    },
    select: { techId: true, cb60Day: true },
  });

  // Calculate CO% per tech
  for (const appt of coAppts) {
    const techId = appt.techId;
    if (!techId || !wpTechIds.has(techId)) continue;
    if (!result.has(techId)) result.set(techId, initStats());
    const stats = result.get(techId)!;
    stats.closeoutOpportunities++;
    if (appt.closedOut || appt.wk1CloseOut) stats.closeouts++;
  }

  // Calculate CB rate per tech
  for (const appt of cbAppts) {
    const techId = appt.techId;
    if (!techId || !wpTechIds.has(techId)) continue;
    if (!result.has(techId)) result.set(techId, initStats());
    const stats = result.get(techId)!;
    stats.callbacks++; // total jobs in CB window
    if (appt.cb60Day) stats.callbackCount++; // jobs that resulted in a callback within 60 days
  }

  return result;
}

// ─── PMP: ROUTE REPORTING ────────────────────────────────────────────────────
async function pullRouteReporting(
  cfg: { key: string; token: string; officeId: number },
  weekStart: Date,
  weekEnd: Date,
  pmpTechs: Map<number, string>
): Promise<Map<string, { totalScheduled: number; completed: number; productionValue: number }>> {

  const result = new Map<string, { totalScheduled: number; completed: number; productionValue: number }>();

  const searchUrl = frUrl('appointment', 'search', {
    officeIDs: String(cfg.officeId),
    dateStart: fmtDate(weekStart),
    dateEnd: fmtDate(weekEnd),
  }, cfg.key, cfg.token);

  const searchData = await frFetch(searchUrl);
  const apptIds: number[] = searchData.appointmentIDs || [];
  if (apptIds.length === 0) return result;

  const allAppts = await fetchInBatches('appointment', 'get', 'appointmentIDs', apptIds, cfg.key, cfg.token);
  const pmpEmpIds = new Set([...pmpTechs.keys()]);
  const apptEmpIds = new Set(allAppts.map((a: any) => parseInt(a.servicedBy || a.employeeID || '0')));
  const matched = [...apptEmpIds].filter(id => pmpEmpIds.has(id));
  // Log for debugging
  console.log(`pullRouteReporting: ${allAppts.length} appts, pmpTechs=${pmpTechs.size}, matched empIds=${matched.length}`);
  // Log value fields from first matched appt
  const samplePmpAppt = allAppts.find((a: any) => pmpEmpIds.has(parseInt(a.servicedBy || a.employeeID || '0')));
  if (samplePmpAppt) console.log(`Sample PMP appt value fields: total=${samplePmpAppt.total}, serviceTotal=${samplePmpAppt.serviceTotal}, productionValue=${samplePmpAppt.productionValue}, amount=${samplePmpAppt.amount}`);

  for (const appt of allAppts) {
    const empId = parseInt(appt.servicedBy || appt.employeeID || appt.technicianID || '0');
    if (!empId || !pmpTechs.has(empId)) continue;

    const techId = pmpTechs.get(empId)!;
    const statusStr = String(appt.status || '');
    const isCompleted = statusStr === '1';
    const isPending   = statusStr === '0';
    if (!isCompleted && !isPending) continue;

    if (!result.has(techId)) result.set(techId, { totalScheduled: 0, completed: 0, productionValue: 0 });
    const entry = result.get(techId)!;
    entry.totalScheduled++;
    if (isCompleted) {
      entry.completed++;
      entry.productionValue += parseFloat(appt.productionValue || appt.total || appt.serviceTotal || '0');
    }
  }

  return result;
}

// ─── PMP: RESERVICES ─────────────────────────────────────────────────────────
async function pullReservices(
  cfg: { key: string; token: string; officeId: number },
  weekStart: Date,
  weekEnd: Date,
  pmpTechs: Map<number, string>
): Promise<Map<string, number>> {

  const result = new Map<string, number>();

  let searchData: any;
  try {
    const searchUrl = frUrl('reservice', 'search', {
      officeIDs: String(cfg.officeId),
      dateStart: fmtDate(weekStart),
      dateEnd: fmtDate(weekEnd),
    }, cfg.key, cfg.token);
    searchData = await frFetch(searchUrl);
  } catch { return result; }

  const reserviceIds: number[] = searchData.reserviceIDs || searchData.reServiceIDs || [];
  if (reserviceIds.length === 0) return result;

  const reservices = await fetchInBatches('reservice', 'get', 'reserviceIDs', reserviceIds, cfg.key, cfg.token);

  for (const rs of reservices) {
    const empId = parseInt(rs.servicedBy || rs.employeeID || rs.technicianID || '0');
    if (!empId || !pmpTechs.has(empId)) continue;
    const techId = pmpTechs.get(empId)!;
    result.set(techId, (result.get(techId) ?? 0) + 1);
  }

  return result;
}

// ─── SCORING ─────────────────────────────────────────────────────────────────
function calcWPScore(coPct: number, cbRate: number | null, driving: number, reliability: number): number {
  const coTerm  = Math.min(coPct + (1 - 0.85), 1.1) * 0.45;
  const cbTerm  = cbRate !== null
    ? ((1 + 0.15 * 2) - cbRate * 2) * 0.30
    : Math.min(coPct + (1 - 0.85), 1.1) * 0.30; // carry-forward if no CB data
  return coTerm + cbTerm + driving * 0.10 + reliability * 0.15;
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

// ─── MAIN ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Default to most recent Friday; allow override
  const weekEnd = body.weekEnd
    ? new Date(body.weekEnd + 'T00:00:00.000Z')
    : getMostRecentFriday();

  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  // Load all active techs with FR employee IDs
  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE', frEmployeeId: { not: null } },
  });

  const log: string[] = [`Week: ${fmtDate(weekStart)} → ${fmtDate(weekEnd)}`];
  const errors: string[] = [];
  let updated = 0;

  for (const [officeName, cfg] of Object.entries(OFFICES)) {
    if (!cfg.key || !cfg.token) { log.push(`${officeName}: skipped (no API key)`); continue; }

    log.push(`\n--- ${officeName} ---`);

    const officeTechs = techs.filter(t => t.office === officeName && t.frEmployeeId);
    const wpTechs  = new Map(officeTechs.filter(t => t.team === 'WP').map(t => [t.frEmployeeId!, t.techId]));
    const pmpTechs = new Map(officeTechs.filter(t => t.team === 'PMP').map(t => [t.frEmployeeId!, t.techId]));

    try {
      // ── WP DATA ──
      const wpMetrics = wpTechs.size > 0
        ? await pullWPMetrics(cfg, weekStart, weekEnd, wpTechs)
        : new Map();

      // ── PMP DATA ── (skipped - PMP is handled by /week, /thirtyDayA, /thirtyDayB, /run endpoints)
      // Do not pull or overwrite PMP data here to avoid corrupting completion%, revEff, reservice

      log.push(`WP techs with data: ${wpMetrics.size}`);

      // ── UPSERT WP ──
      for (const tech of officeTechs.filter(t => t.team === 'WP')) {
        const metrics = wpMetrics.get(tech.techId);
        if (!metrics) continue;

        const coOpps  = metrics.closeoutOpportunities ?? 0;
        const coCount = metrics.closeouts ?? 0;
        const cbJobs  = metrics.callbacks ?? 0;
        const cbCount = metrics.callbackCount ?? 0;

        // Fetch prior week as fallback (Excel: if <5 CO jobs use prior week, if <10 CB jobs use prior week)
        const priorWeek = await prisma.techWeek.findFirst({
          where: { techId: tech.techId, weekEnd: { lt: weekEnd } },
          orderBy: { weekEnd: 'desc' },
          select: { closeOutPct: true, callbackRate: true },
        });

        // CO%: use calculated if ≥5 jobs, else fall back to prior week (Excel rule: AE<5)
        let coPct: number | null = null;
        if (coOpps >= 5) {
          coPct = coCount / coOpps;
        } else if (priorWeek?.closeOutPct != null) {
          coPct = priorWeek.closeOutPct; // carry forward prior week
        }

        // CB Rate: use calculated if ≥10 jobs, else fall back to prior week (Excel rule: AG<10)
        let cbRate: number | null = null;
        if (cbJobs >= 10) {
          cbRate = cbCount / cbJobs;
        } else if (priorWeek?.callbackRate != null) {
          cbRate = priorWeek.callbackRate; // carry forward prior week
        }

        const existing = await prisma.techWeek.findUnique({
          where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
        });

        const updateData: any = {
          closeOutPct:  coPct,
          callbackRate: cbRate,
          coJobs:       coCount,
          updatedAt:    new Date(),
        };

        // Recalculate WP score if driving + reliability available
        if (coPct !== null && existing?.drivingScore && existing?.reliabilityScore) {
          const wpScore = calcWPScore(coPct, cbRate, existing.drivingScore, existing.reliabilityScore);
          updateData.wpScore    = wpScore;
          updateData.totalScore = wpScore + (existing.manualAdj ?? 0);
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
              siteLeader:   tech.siteLeader,
              crewLeader:   tech.crewLeader,
              closeOutPct:  coPct,
              callbackRate: cbRate,
              coJobs:       coCount,
              manualAdj:    0,
            },
          });
        }

        updated++;
        log.push(`  ${tech.techId} ${tech.name}: CO=${coPct !== null ? (coPct*100).toFixed(0)+'%' : '—'} (${coCount}/${coOpps}), CB=${cbRate !== null ? (cbRate*100).toFixed(1)+'%' : '—'}`);
      }

      // PMP upsert removed — PMP metrics are handled by /week, /thirtyDayA, /thirtyDayB, /run endpoints

    } catch (e: any) {
      const msg = `${officeName} error: ${e.message}`;
      errors.push(msg);
      log.push(msg);
    }
  }

  log.push(`\nTotal techs updated: ${updated}`);

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    weekEnd: fmtDate(weekEnd),
    weekStart: fmtDate(weekStart),
    techsUpdated: updated,
    errors,
    log: log.join('\n'),
  });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return POST(new NextRequest(req.url, { method: 'POST', headers: req.headers, body: '{}' }));
}
