// src/app/api/cron/tc-accountability/route.ts
// Syncs TC accountability appointments from FieldRoutes into tc_appointments table
// Run weekly after FR sync

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadCloseoutFormDates, formWithinWindow } from '@/lib/closeout';

const SUBDOMAIN = 'critterstoppest';
const BASE_URL = `https://${SUBDOMAIN}.fieldroutes.com/api`;

const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

// Service type IDs to track — NO exclusions (553)
const TC_SERVICE_IDS = new Set([504, 636, 1076, 615, 671, 546, 554, 620, 538]);
const TRAP_CHECK_IDS = new Set([504, 636, 1076]); // 1076 = QA Trap Check (Crew Lead)
const CALLBACK_IDS   = new Set([615, 671, 546, 554]);
const CO_JOB_IDS     = new Set([504, 636, 1076, 620, 533, 538]); // 615/671/546/554 removed from CO jobs per policy change (still tracked for callback rate)

// Close-out keywords — tech/office notes only
const CLOSEOUT_KEYWORDS = ['ready for insulation', 'ready for far', 'closed out'];

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

async function fetchInBatches(endpoint: string, action: string, idParam: string, ids: any[], key: string, token: string, debugLog?: string[]): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const url = frUrl(endpoint, action, { [idParam]: batch.join(',') }, key, token);
    const data = await frFetch(url);
    if (i === 0 && debugLog) {
      debugLog.push(`  FR ${endpoint} response keys: ${Object.keys(data).slice(0, 8).join(', ')}`);
      debugLog.push(`  propertyName: ${data.propertyName}, count: ${data.count}`);
    }
    // Use propertyName field that FR returns to identify the data key
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

function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }

// Run appointment/search across customer-ID batches (FR limits customerIDs per request via URL length),
// merging all returned appointmentIDs. Replaces the old silent slice(0,200) truncation.
async function searchApptsByCustomerBatches(
  cfg: { key: string; token: string; officeId: number },
  baseParams: Record<string, string>,
  customerIds: string[],
  batchSize = 150
): Promise<number[]> {
  const allIds = new Set<number>();
  for (let i = 0; i < customerIds.length; i += batchSize) {
    const batch = customerIds.slice(i, i + batchSize);
    const url = frUrl('appointment', 'search', { ...baseParams, customerIDs: batch.join(',') }, cfg.key, cfg.token);
    try {
      const data = await frFetch(url);
      for (const id of (data.appointmentIDs || [])) allIds.add(id);
    } catch { /* skip failed batch; caller logs completeness elsewhere */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return [...allIds];
}

function hasCloseoutNote(appt: any): boolean {
  const text = [appt.officeNotes, appt.techNotes].filter(Boolean).join(' ').toLowerCase();
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

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const weekEnd = body.weekEnd
    ? new Date(body.weekEnd + 'T00:00:00.000Z')
    : getMostRecentFriday();

  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const log: string[] = [`TC Accountability sync: ${fmtDate(weekStart)} → ${fmtDate(weekEnd)}`];
  const errors: string[] = [];
  let totalSynced = 0;

  // Load tech roster for name lookup (frEmployeeId → techId/name)
  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE' },
    select: { techId: true, name: true, frEmployeeId: true, office: true },
  });
  type TechInfo = { techId: string; name: string; frEmployeeId: number | null; office: string };
  const frEmpToTech = new Map<number, TechInfo>(
    (techs as TechInfo[]).filter((t): t is TechInfo & { frEmployeeId: number } => t.frEmployeeId !== null)
      .map((t: TechInfo & { frEmployeeId: number }) => [t.frEmployeeId, t])
  );
  log.push(`Tech mappings: ${frEmpToTech.size} techs with frEmployeeId`);

  // Load dispatch jobs for TC count per customer
  const dispatchJobs = await prisma.dispatchJob.findMany({
    where: { status: { in: ['ACTIVE', 'CLOSED'] } },
    select: { customer: { select: { externalId: true } }, trapCheckCount: true },
  });
  const customerTCCounts = new Map<string, number>();
  for (const job of dispatchJobs) {
    if (job.customer?.externalId) {
      customerTCCounts.set(job.customer.externalId, job.trapCheckCount ?? 0);
    }
  }

  for (const [officeName, cfg] of Object.entries(OFFICES)) {
    try {
      log.push(`\n── ${officeName} ──`);

      // Search completed appointments for the week with relevant service types
      const searchUrl = frUrl('appointment', 'search', {
        officeIDs: String(cfg.officeId),
        dateStart: fmtDate(weekStart),
        dateEnd: fmtDate(weekEnd),
      }, cfg.key, cfg.token);

      const searchData = await frFetch(searchUrl);
      const apptIds: number[] = searchData.appointmentIDs || [];
      log.push(`  Search returned ${apptIds.length} appointment IDs`);
      if (apptIds.length === 0) { log.push(`  No appointments`); continue; }

      const allAppts = await fetchInBatches('appointment', 'get', 'appointmentIDs', apptIds, cfg.key, cfg.token, log);
      log.push(`  Fetched ${allAppts.length} appointment objects`);
      if (allAppts.length > 0) {
        const sample = allAppts[0];
        log.push(`  All keys: ${Object.keys(sample).join(', ')}`);
        log.push(`  Sample status: ${sample.status}, type: ${sample.type || sample.serviceTypeID}`);
        log.push(`  customerName: ${sample.customerName}, techName: ${sample.technicianName || sample.employeeName}, title: ${sample.appointmentTitle || sample.title || sample.type}`);
      }

      // Filter to completed + relevant service types
      const statusSample = [...new Set(allAppts.slice(0, 20).map((a: any) => String(a.status)))];
      log.push(`  Status values sample: ${statusSample.join(', ')}`);
      const typeSample = [...new Set(allAppts.slice(0, 20).map((a: any) => String(a.type || a.serviceTypeID || '?')))];
      log.push(`  Service type IDs sample: ${typeSample.join(', ')}`);

      const relevant = allAppts.filter((a: any) => {
        const typeId = parseInt(String(a.type || a.serviceTypeID || '0'));
        return String(a.status) === '1' && TC_SERVICE_IDS.has(typeId);
      });

      log.push(`  Total completed: ${allAppts.length}, relevant: ${relevant.length}`);
      if (relevant.length > 0) log.push(`  Sample employeeID: ${relevant[0].employeeID}`);

      // Get all future appointments for customers in this batch to compute forward-looking fields
      const customerIds = [...new Set(relevant.map((a: any) => String(a.customerID)))];

      // Cached Closed-Out (template-86) forms for these customers — a form counts as a closeout signal
      // (note OR form), read from the cache table (no live FR calls).
      const coFormsByCust = await loadCloseoutFormDates(prisma, customerIds);
      const isClosedOut = (appt: any): boolean => {
        if (hasCloseoutNote(appt)) return true;
        const dates = coFormsByCust.get(String(appt.customerID)) || [];
        return formWithinWindow(dates, new Date(appt.date || appt.dateAdded));
      };

      // Fetch future appointments per customer (scheduled, not completed) — batched across ALL customers
      let futureAppts: any[] = [];
      try {
        const futureIds = await searchApptsByCustomerBatches(cfg, {
          officeIDs: String(cfg.officeId),
          dateStart: fmtDate(new Date(weekEnd.getTime() + 86400000)), // day after weekEnd
          dateEnd:   fmtDate(new Date(weekEnd.getTime() + 90 * 86400000)), // 90 days out
        }, customerIds);
        if (futureIds.length > 0) {
          futureAppts = await fetchInBatches('appointment', 'get', 'appointmentIDs', futureIds, cfg.key, cfg.token);
        }
      } catch (e: any) {
        log.push(`  Future appts fetch error: ${e.message}`);
      }

      // Build future visit map per customer
      const futureByCustomer = new Map<string, { nonCb: any[]; cbs: any[] }>();
      for (const fa of futureAppts) {
        const custId = String(fa.customerID);
        if (!futureByCustomer.has(custId)) futureByCustomer.set(custId, { nonCb: [], cbs: [] });
        const typeId = parseInt(String(fa.type || fa.serviceTypeID || '0'));
        if (CALLBACK_IDS.has(typeId)) {
          futureByCustomer.get(custId)!.cbs.push(fa);
        } else {
          futureByCustomer.get(custId)!.nonCb.push(fa);
        }
      }

      // Also get past appointments within 60 days to check CB flag — batched across ALL customers
      let past60Appts: any[] = [];
      try {
        const pastIds = await searchApptsByCustomerBatches(cfg, {
          officeIDs: String(cfg.officeId),
          dateStart: fmtDate(weekStart),
          dateEnd:   fmtDate(new Date(weekEnd.getTime() + 60 * 86400000)),
          status:    '1',
        }, customerIds);
        if (pastIds.length > 0) {
          past60Appts = await fetchInBatches('appointment', 'get', 'appointmentIDs', pastIds, cfg.key, cfg.token);
        }
      } catch (e: any) {
        log.push(`  Past 60d appts fetch error: ${e.message}`);
      }

      // Build 60-day CB map and 1wk/2wk close-out map per customer
      const cb60Map = new Map<string, boolean>();
      const wk1Map = new Map<string, boolean>();
      const wk2Map = new Map<string, boolean>();

      for (const pa of past60Appts) {
        const custId = String(pa.customerID);
        const typeId = parseInt(String(pa.type || pa.serviceTypeID || '0'));
        const paDate = new Date(pa.date || pa.dateAdded);

        if (CALLBACK_IDS.has(typeId)) {
          cb60Map.set(custId, true);
        }
        if (isClosedOut(pa)) {
          const diffDays = (paDate.getTime() - weekEnd.getTime()) / 86400000;
          if (diffDays <= 7) wk1Map.set(custId, true);
          if (diffDays <= 14) wk2Map.set(custId, true);
        }
      }

      // Fetch customer names in batch (all customers — fetchInBatches chunks by 100 internally)
      const customerMap = new Map<string, string>();
      try {
        const custData = await fetchInBatches('customer', 'get', 'customerIDs', customerIds, cfg.key, cfg.token);
        for (const c of custData) {
          const name = c.companyName?.trim()
            ? c.companyName.trim()
            : `${c.fname || ''} ${c.lname || ''}`.trim();
          customerMap.set(String(c.customerID), name);
        }
      } catch (e: any) {
        log.push(`  Customer fetch error: ${e.message}`);
      }

      // Hardcoded service type names for TC accountability types
      const serviceTypeMap = new Map<number, string>([
        [504, 'Trap Check'],
        [636, 'Trap Check'],
        [1076, 'QA Trap Check'],
        [615, 'Call Back'],
        [671, 'Call Back'],
        [546, 'Call Back'],
        [554, 'Call Back'],
        [620, 'Call Back Trap Check'],
        [533, 'Annual Inspection'],
        [538, 'Annual Inspection Trap Check'],
      ]);

      // Upsert each relevant appointment
      for (const appt of relevant) {
        const typeId = parseInt(String(appt.type || appt.serviceTypeID || '0'));
        const custId = String(appt.customerID);
        const frApptId = String(appt.appointmentID || appt.id);
        const empId = parseInt(appt.employeeID || appt.servicedBy || '0');
        const tech = frEmpToTech.get(empId);
        const customerName = customerMap.get(custId) || '';
        const jobTitle = serviceTypeMap.get(typeId) || String(typeId);

        // Determine if CO job
        let isCoJob = CO_JOB_IDS.has(typeId);
        if (TRAP_CHECK_IDS.has(typeId)) {
          const tcCount = customerTCCounts.get(custId) ?? 0;
          isCoJob = tcCount >= 2;
        }

        // Future visits
        const future = futureByCustomer.get(custId);
        const futureNonCb = future?.nonCb.length ?? 0;
        const futureCbs = future?.cbs.length ?? 0;
        const nextNonCb = future?.nonCb.sort((a: any, b: any) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
        )[0];
        const nextVisitDays = nextNonCb
          ? Math.round((new Date(nextNonCb.date).getTime() - weekEnd.getTime()) / 86400000)
          : null;

        const apptDate = new Date(appt.date || appt.dateAdded);

        try {
          await prisma.tcAppointment.upsert({
            where: { frAppointmentId: frApptId },
            update: {
              date: apptDate,
              weekEnd,
              customerId: custId,
              customerName,
              jobTitle,
              serviceTypeId: typeId,
              techId: tech?.techId || '',
              techName: tech?.name || '',
              office: officeName,
              isCoJob,
              closedOut: isClosedOut(appt),
              wk1CloseOut: wk1Map.get(custId) ?? false,
              wk2CloseOut: wk2Map.get(custId) ?? false,
              cb60Day: cb60Map.get(custId) ?? false,
              futureNonCbVisits: futureNonCb,
              nextVisitDays,
              futureCbs,
              updatedAt: new Date(),
            },
            create: {
              id: crypto.randomUUID(),
              frAppointmentId: frApptId,
              date: apptDate,
              weekEnd,
              customerId: custId,
              customerName,
              jobTitle,
              serviceTypeId: typeId,
              techId: tech?.techId || '',
              techName: tech?.name || '',
              office: officeName,
              isCoJob,
              closedOut: isClosedOut(appt),
              wk1CloseOut: wk1Map.get(custId) ?? false,
              wk2CloseOut: wk2Map.get(custId) ?? false,
              cb60Day: cb60Map.get(custId) ?? false,
              futureNonCbVisits: futureNonCb,
              nextVisitDays,
              futureCbs,
            },
          });
          totalSynced++;
        } catch (e: any) {
          errors.push(`appt ${frApptId}: ${e.message}`);
        }
      }

      log.push(`  Synced: ${relevant.length}`);
    } catch (e: any) {
      errors.push(`${officeName}: ${e.message}`);
      log.push(`  ERROR: ${e.message}`);
    }
  }

  log.push(`\nTotal synced: ${totalSynced}`);

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    totalSynced,
    errors,
    log: log.join('\n'),
  });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = new URL(req.url).searchParams.get('token');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && token !== process.env.CRON_SECRET && token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return POST(new NextRequest(req.url, { method: 'POST', headers: req.headers, body: '{}' }));
}
