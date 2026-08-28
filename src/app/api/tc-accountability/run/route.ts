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
const CO_JOB_IDS     = new Set([504, 636, 1076, 615, 671, 546, 554, 620, 533, 538]);

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

// Run appointment/search across customer-ID batches, merging appointmentIDs.
// Replaces the old silent slice(0,200) truncation (offices with >200 TC customers/week lost data).
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
    } catch { /* skip failed batch */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return [...allIds];
}

function hasCloseoutNote(appt: any): boolean {
  const text = [appt.officeNotes, appt.notes, appt.appointmentNotes].filter(Boolean).join(' ').toLowerCase();
  return ['ready for insulation', 'ready for far', 'closed out'].some(k => text.includes(k));
}

function getMostRecentFriday(offsetWeeks = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysToFri = day >= 5 ? day - 5 : day + 2;
  d.setDate(d.getDate() - daysToFri - offsetWeeks * 7);
  return d;
}

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token');
  if (token !== 'critterstop2026' && token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekEndParam = new URL(req.url).searchParams.get('weekEnd');
  const { searchParams } = new URL(req.url);
  const weekEnd = weekEndParam
    ? new Date(weekEndParam + 'T00:00:00.000Z')
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
  // Also build name → tech map as fallback (lowercase for case-insensitive match)
  const nameToTech = new Map<string, TechInfo>(
    (techs as TechInfo[]).map(t => [t.name.toLowerCase(), t])
  );
  log.push(`Tech mappings: ${frEmpToTech.size} techs with frEmployeeId, ${nameToTech.size} by name`);

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

  const officeFilter = searchParams.get('office');
  const officesToRun = officeFilter && OFFICES[officeFilter]
    ? { [officeFilter]: OFFICES[officeFilter] }
    : OFFICES;

  for (const [officeName, cfg] of Object.entries(officesToRun)) {
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
        log.push(`  servicedBy: ${sample.servicedBy}, assignedTech: ${sample.assignedTech}, completedBy: ${sample.completedBy}`);
        log.push(`  customerName: ${sample.customerName}, techName: ${sample.technicianName || sample.employeeName}, title: ${sample.appointmentTitle || sample.title || sample.type}`);
      }

      // Filter to completed + pending with relevant service types
      const statusSample = [...new Set(allAppts.slice(0, 20).map((a: any) => String(a.status)))];
      log.push(`  Status values sample: ${statusSample.join(', ')}`);
      const typeSample = [...new Set(allAppts.slice(0, 20).map((a: any) => String(a.type || a.serviceTypeID || '?')))];
      log.push(`  Service type IDs sample: ${typeSample.join(', ')}`);

      const relevant = allAppts.filter((a: any) => {
        const typeId = parseInt(String(a.type || a.serviceTypeID || '0'));
        return (String(a.status) === '1' || String(a.status) === '0') && TC_SERVICE_IDS.has(typeId);
      });

      if (relevant.length > 0) log.push(`  Sample employeeID: ${relevant[0].employeeID}`);

      // Get all future appointments for customers in this batch to compute forward-looking fields
      const customerIds = [...new Set(relevant.map((a: any) => String(a.customerID)))];
      // Cached Closed-Out (template-86) forms — a form counts as a closeout signal (note OR form).
      const coFormsByCust = await loadCloseoutFormDates(prisma, customerIds);
      const isClosedOut = (appt: any): boolean => {
        if (!appt) return false;
        if (hasCloseoutNote(appt)) return true;
        const dates = coFormsByCust.get(String(appt.customerID)) || [];
        return formWithinWindow(dates, new Date(appt.date || appt.dateAdded));
      };

      // Fetch future appointments per customer — 180 days out, all types — batched across ALL customers
      let futureAppts: any[] = [];
      try {
        const futureIds = await searchApptsByCustomerBatches(cfg, {
          officeIDs: String(cfg.officeId),
          dateStart: fmtDate(new Date(weekEnd.getTime() + 86400000)), // day after weekEnd
          dateEnd:   fmtDate(new Date(weekEnd.getTime() + 180 * 86400000)), // 180 days out per Excel
        }, customerIds);
        if (futureIds.length > 0) {
          futureAppts = await fetchInBatches('appointment', 'get', 'appointmentIDs', futureIds, cfg.key, cfg.token);
        }
      } catch (e: any) {
        log.push(`  Future appts fetch error: ${e.message}`);
      }

      // Build future visit map per customer
      // nonCb = trap checks only (not callbacks "<>*call*" and not annual inspections "<>*annual*")
      const futureByCustomer = new Map<string, { nonCb: any[]; cbs: any[] }>();
      for (const fa of futureAppts) {
        const custId = String(fa.customerID);
        if (!futureByCustomer.has(custId)) futureByCustomer.set(custId, { nonCb: [], cbs: [] });
        const jobTitle = String(fa.appointmentTitle || fa.title || fa.type || '').toLowerCase();
        const isCallback = jobTitle.includes('call');
        const isAnnual = jobTitle.includes('annual');
        if (isCallback) {
          futureByCustomer.get(custId)!.cbs.push(fa);
        } else if (!isAnnual) {
          // Only trap checks count as future non-CB visits (exclude annual inspections)
          futureByCustomer.get(custId)!.nonCb.push(fa);
        }
      }

      // Fetch appointments for cb60Day — callbacks within 60 days — batched across ALL customers
      let cb60Appts: any[] = [];
      try {
        const cbIds = await searchApptsByCustomerBatches(cfg, {
          officeIDs: String(cfg.officeId),
          dateStart: fmtDate(weekStart),
          dateEnd:   fmtDate(new Date(weekEnd.getTime() + 60 * 86400000)),
        }, customerIds);
        if (cbIds.length > 0) {
          cb60Appts = await fetchInBatches('appointment', 'get', 'appointmentIDs', cbIds, cfg.key, cfg.token);
        }
      } catch (e: any) {
        log.push(`  CB 60d appts fetch error: ${e.message}`);
      }

      // Build callback map: custId → array of callback dates
      // cb60Day: COUNTIFS(customer=D, jobTitle contains "call", date > apptDate, date <= apptDate+60)
      const cbDatesByCustomer = new Map<string, Date[]>();
      for (const ca of cb60Appts) {
        const custId = String(ca.customerID);
        const jobTitle = String(ca.appointmentTitle || ca.title || '').toLowerCase();
        if (!jobTitle.includes('call')) continue;
        if (!cbDatesByCustomer.has(custId)) cbDatesByCustomer.set(custId, []);
        cbDatesByCustomer.get(custId)!.push(new Date(ca.date || ca.dateAdded));
      }

      // wk1CloseOut: next future non-CB visit for same customer has closedOut=true
      // We build a map: custId → closedOut status of next future visit
      // This will be calculated per-appointment using futureByCustomer and closedOut flag
      // wk2CloseOut: futureNonCbVisits === 2 (exactly 2 future non-CB visits per Excel Col O)

      // Fetch customer names in batch
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

      // For pending appointments, fetch routes to get assignedTech
      const routeToEmpId = new Map<string, number>();
      try {
        const pendingRouteIds = [...new Set(
          relevant
            .filter((a: any) => String(a.status) === '0')
            .map((a: any) => String(a.routeID))
            .filter((id: string) => id && id !== '0')
        )];
        if (pendingRouteIds.length > 0) {
          const routeData = await fetchInBatches('route', 'get', 'routeIDs', pendingRouteIds, cfg.key, cfg.token);
          for (const r of routeData) {
            const empId = parseInt(r.assignedTech || '0');
            if (empId > 0) routeToEmpId.set(String(r.routeID), empId);
          }
          log.push(`  Routes fetched for pending: ${pendingRouteIds.length}, mapped: ${routeToEmpId.size}`);
        }
      } catch (e: any) {
        log.push(`  Route fetch error: ${e.message}`);
      }

      // Fetch employee names from FR using employeeIDs
      const employeeMap = new Map<number, string>();
      try {
        const empIds = [...new Set(relevant.map((a: any) => {
          if (String(a.status) === '1') return parseInt(a.servicedBy || a.employeeID || '0');
          return routeToEmpId.get(String(a.routeID)) || parseInt(a.assignedTech || '0');
        }).filter(Boolean))];
        if (empIds.length > 0) {
          const empData = await fetchInBatches('employee', 'get', 'employeeIDs', empIds, cfg.key, cfg.token);
          for (const e of empData) {
            const name = `${e.fname || e.firstName || ''} ${e.lname || e.lastName || ''}`.trim() || e.name || '';
            employeeMap.set(parseInt(e.employeeID || e.id), name);
          }
          log.push(`  Employees fetched: ${employeeMap.size}`);
          if (employeeMap.size > 0) {
            const sample = [...employeeMap.entries()][0];
            log.push(`  Sample employee: ${sample[0]} → ${sample[1]}`);
          }
        }
      } catch (e: any) {
        log.push(`  Employee fetch error: ${e.message}`);
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
        const apptStatus = String(appt.status) === '1' ? 'completed' : 'pending';
        const empId = apptStatus === 'completed'
          ? parseInt(appt.servicedBy || appt.assignedTech || appt.employeeID || '0')
          : (routeToEmpId.get(String(appt.routeID)) || parseInt(appt.assignedTech || '0'));
        const techNameFromFR = employeeMap.get(empId) || '';
        const tech = frEmpToTech.get(empId) || nameToTech.get(techNameFromFR.toLowerCase());
        const customerName = customerMap.get(custId) || '';
        const jobTitle = serviceTypeMap.get(typeId) || String(typeId);

        // Determine if CO job
        let isCoJob = CO_JOB_IDS.has(typeId);
        if (TRAP_CHECK_IDS.has(typeId)) {
          const tcCount = customerTCCounts.get(custId) ?? 0;
          isCoJob = tcCount >= 2;
        }
        // Rule 3: if closed out, always a CO job regardless of trap check count
        const closedOut = isClosedOut(appt);
        if (closedOut) isCoJob = true;

        // Future visits — trap checks only, not callbacks or annual inspections, within 180 days
        const future = futureByCustomer.get(custId);
        const futureNonCb = future?.nonCb.length ?? 0;
        const futureCbs = future?.cbs.length ?? 0;

        // Next visit days — days from appointment date to nearest future non-CB visit
        const sortedNonCb = (future?.nonCb ?? []).slice().sort((a: any, b: any) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        const nextNonCb = sortedNonCb[0];
        const apptDate = new Date(appt.date || appt.dateAdded);
        const nextVisitDays = nextNonCb
          ? Math.round((new Date(nextNonCb.date || nextNonCb.dateAdded).getTime() - apptDate.getTime()) / 86400000)
          : null;

        // wk1CloseOut: next future non-CB visit has closedOut=true (Excel Col N: XLOOKUP finds next visit M=1)
        // We check if the next future visit has a closeout note
        const wk1CloseOut = nextNonCb ? isClosedOut(nextNonCb) : false;

        // wk2CloseOut: exactly 2 future non-CB visits (Excel Col O: K5=2)
        const wk2CloseOut = futureNonCb === 2;

        // cb60Day: count of callbacks within 60 days AFTER this appointment's date
        const custCbDates = cbDatesByCustomer.get(custId) ?? [];
        const apptTime = apptDate.getTime();
        const cb60Count = custCbDates.filter(d =>
          d.getTime() > apptTime && d.getTime() <= apptTime + 60 * 86400000
        ).length;
        const cb60Day = cb60Count > 0;

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
              ...(tech ? { techId: tech.techId, techName: tech.name } : techNameFromFR ? { techName: techNameFromFR } : {}),
              office: officeName,
              isCoJob,
              apptStatus,
              closedOut,
              wk1CloseOut,
              wk2CloseOut,
              cb60Day,
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
              techName: tech?.name || techNameFromFR,
              office: officeName,
              isCoJob,
              apptStatus,
              closedOut,
              wk1CloseOut,
              wk2CloseOut,
              cb60Day,
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
