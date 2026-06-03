import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const OFFICES = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 1000;
const EXCLUSION_APPT_TYPES = new Set(['553', '716']);
const TRAP_CHECK_APPT_TYPES = new Set(['504', '636']);
const FAR_APPT_TYPES = new Set(['624', '542', '479', '674']);
const REMOVAL_ONLY_TYPE = '1073';
const TRAPPING_PRODUCT_IDS = new Set([8]);
const FAR_PRODUCT_IDS = new Set([10]);
const TRAPPING_KEYWORDS = ['trapping', 'trap'];
const FAR_KEYWORDS = ['full attic', 'insulation', 'far', 'blow-in'];
const TRAPPING_DONE_KEYWORDS = ['ready for insulation', 'ready for far', 'close out', 'closed out'];
const TRAPPING_ONLY_APPT_TYPES = new Set(['720']);

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchInBatches(endpoint: string, idParam: string, ids: any[], key: string, token: string): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE).join(',');
    const data = await frFetch(endpoint, `${idParam}=${batch}`, key, token);
    const prop = data.propertyName;
    if (data.success && prop && data[prop]) results.push(...data[prop]);
    await new Promise(r => setTimeout(r, 150));
  }
  return results;
}

function hasTrapping(items: any[], serviceID: string): boolean {
  if (serviceID === '720') return true;
  return items.some(item =>
    TRAPPING_PRODUCT_IDS.has(Number(item.productID)) ||
    TRAPPING_KEYWORDS.some(k => item.description?.toLowerCase().includes(k))
  );
}

function hasFAR(items: any[], serviceID: string): boolean {
  if (['501', '674', '479', '541', '542', '624'].includes(serviceID)) return true;
  return items.some(item =>
    FAR_PRODUCT_IDS.has(Number(item.productID)) ||
    FAR_KEYWORDS.some(k => item.description?.toLowerCase().includes(k))
  );
}

function safeDate(dateStr: string | null | undefined, fallback: Date | null = null): Date | null {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? fallback : d;
}

function hasTrappingDoneNote(appts: any[]): boolean {
  return appts.some((a: any) =>
    TRAPPING_DONE_KEYWORDS.some(k =>
      a.officeNotes?.toLowerCase().includes(k) ||
      a.appointmentNotes?.toLowerCase().includes(k) ||
      a.notes?.toLowerCase().includes(k)
    )
  );
}

async function syncDispatch(office: string, key: string, token: string) {
  let updated = 0, errors = 0;

  const jobs = await prisma.dispatchJob.findMany({
    where: { office, status: 'ACTIVE' },
    include: {
      customer: { select: { id: true, externalId: true } },
      invoice: { select: { id: true, externalId: true } },
    },
  });

  if (jobs.length === 0) return { updated: 0, errors: 0 };
  console.log(`[${office}] Syncing ${jobs.length} dispatch jobs...`);

  const ticketIds = [...new Set(jobs.map(j => j.invoice?.externalId).filter(Boolean))];

  // ============================================================
  // STEP 1: Fetch all tickets for hasTrapping / hasFAR detection
  // ============================================================
  console.log(`[${office}] Fetching ${ticketIds.length} tickets...`);
  const tickets = await fetchInBatches('ticket/get', 'ticketIDs', ticketIds, key, token);
  const ticketMap = new Map<string, any>();
  for (const t of tickets) ticketMap.set(String(t.ticketID), t);

  // ============================================================
  // STEP 2: Fetch ALL appointments since 2026-01-01, filter client-side
  // ============================================================
  console.log(`[${office}] Fetching all appointments...`);
  const apptSearch = await frFetch('appointment/search', 'dateStart=2026-01-01', key, token);
  const apptIds: number[] = apptSearch.appointmentIDs || [];

  if (apptIds.length === 0) {
    console.log(`[${office}] No appointments returned - aborting to prevent data corruption`);
    return { updated: 0, errors: 0 };
  }

  console.log(`[${office}] Fetching ${apptIds.length} appointment details...`);
  const allAppts = await fetchInBatches('appointment/get', 'appointmentIDs', apptIds, key, token);

  if (allAppts.length === 0) {
    console.log(`[${office}] No appointment details returned - aborting to prevent data corruption`);
    return { updated: 0, errors: 0 };
  }

  // Filter by type and completed status client-side
  const exclusionAppts = allAppts.filter((a: any) =>
    EXCLUSION_APPT_TYPES.has(String(a.type)) && a.status === '1'
  );
  const trapAppts = allAppts.filter((a: any) =>
    TRAP_CHECK_APPT_TYPES.has(String(a.type)) && a.status === '1'
  );
  const farAppts = allAppts.filter((a: any) =>
    FAR_APPT_TYPES.has(String(a.type)) && a.status === '1'
  );
  const removalAppts = allAppts.filter((a: any) =>
    String(a.type) === REMOVAL_ONLY_TYPE && a.status === '1'
  );

  console.log(`[${office}] Exclusion: ${exclusionAppts.length}, Trap: ${trapAppts.length}, FAR: ${farAppts.length}, Removal-only: ${removalAppts.length}`);

  const buildCustomerMap = (appts: any[]) => {
    const map = new Map<string, any[]>();
    for (const a of appts) {
      const arr = map.get(String(a.customerID)) || [];
      arr.push(a);
      map.set(String(a.customerID), arr);
    }
    return map;
  };

  const exclusionByCustomer = buildCustomerMap(exclusionAppts);
  const trapByCustomer = buildCustomerMap(trapAppts);
  const farByCustomer = buildCustomerMap(farAppts);
  const removalByCustomer = buildCustomerMap(removalAppts);
  const trappingOnlyByCustomer = buildCustomerMap(allAppts.filter((a: any) =>
    TRAPPING_ONLY_APPT_TYPES.has(String(a.type)) && a.status === '1'
  ));

  // ============================================================
  // STEP 3: Update each dispatch job
  // ============================================================
  for (const job of jobs) {
    try {
      const custFRId = job.customer?.externalId;
      const ticketId = job.invoice?.externalId;
      if (!custFRId || !ticketId) continue;

      const ticket = ticketMap.get(ticketId);
      const items = ticket?.items || [];
      const serviceID = ticket?.serviceID || '';

      const jobHasTrapping = hasTrapping(items, serviceID);
      const jobHasFAR = hasFAR(items, serviceID);

      // Exclusion
      const custExclusionAppts = (exclusionByCustomer.get(custFRId) || [])
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const exclusionDone = custExclusionAppts.length > 0;
      const exclusionDate = custExclusionAppts[0]
        ? safeDate(custExclusionAppts[0].date, job.exclusionDate)
        : job.exclusionDate;

      // Trap checks
      const custTrapAppts = (trapByCustomer.get(custFRId) || [])
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const trapCheckCount = custTrapAppts.length;
      const lastTrapCheck = custTrapAppts[0]
        ? safeDate(custTrapAppts[0].date, job.lastTrapCheck)
        : job.lastTrapCheck;

      // Trapping done - check notes on any trap check appointment
      const trapsDone = jobHasTrapping && hasTrappingDoneNote(custTrapAppts);

      // FAR - completed blow-in appointment
      const custFarAppts = (farByCustomer.get(custFRId) || [])
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const farDone = custFarAppts.length > 0;
      const farDate = custFarAppts[0]
        ? safeDate(custFarAppts[0].date, job.farDate)
        : job.farDate;

      // Removal only
      const custRemovalAppts = (removalByCustomer.get(custFRId) || [])
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const removalDone = custRemovalAppts.length > 0;
      const removalDate = custRemovalAppts[0]
        ? safeDate(custRemovalAppts[0].date, null)
        : null;

      // Close out logic
      let closedOut = job.closedOut;
      let closedOutDate = job.closedOutDate;
      let jobStatus = job.status;

      // FAR blow-in done = closed out
      if (farDone && !closedOut) {
        closedOut = true;
        closedOutDate = farDate || new Date();
      }

      // Removal only done = closed out
      if (removalDone && !closedOut) {
        closedOut = true;
        closedOutDate = removalDate || new Date();
      }

      // Trapping done + no FAR = closed out
      if (trapsDone && !jobHasFAR && !closedOut) {
        closedOut = true;
        closedOutDate = lastTrapCheck || new Date();
      }

      // Auto close-out: exclusion done + no trapping + no FAR
      if (exclusionDone && !jobHasTrapping && !jobHasFAR && !closedOut) {
        closedOut = true;
        closedOutDate = exclusionDate || new Date();
      }

      if (closedOut) jobStatus = 'CLOSED';

      await prisma.dispatchJob.update({
        where: { id: job.id },
        data: {
          hasTrapping: jobHasTrapping,
          hasFAR: jobHasFAR,
          exclusionDone,
          exclusionDate,
          trapCheckCount,
          lastTrapCheck,
          trapsDone,
          farDone,
          farDate,
          closedOut,
          closedOutDate,
          status: jobStatus,
        },
      });

      // Update invoice due date if newly closed out
      if (closedOut && closedOutDate && job.invoice?.id) {
        const inv = await prisma.invoice.findUnique({
          where: { id: job.invoice.id },
          select: { due: true },
        });
        if (!inv?.due) {
          await prisma.invoice.update({
            where: { id: job.invoice.id },
            data: {
              due: closedOutDate,
              status: closedOutDate < new Date() ? 'OVERDUE' : 'CURRENT',
            },
          });
        }
      }

      updated++;
    } catch (err: any) {
      errors++;
      console.error(`[${office}] Error updating job ${job.id}:`, err.message);
    }
  }

  console.log(`[${office}] Dispatch sync complete: ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const officesToSync = body.office ? [body.office] : Object.keys(OFFICES);
  const results: Record<string, any> = {};

  for (const office of officesToSync) {
    const config = OFFICES[office as keyof typeof OFFICES];
    if (!config) continue;
    try {
      results[office] = await syncDispatch(office, config.key, config.token);
    } catch (err: any) {
      results[office] = { error: err.message };
    }
  }

  return NextResponse.json({ success: true, results });
}
