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
const TRAPPING_PRODUCT_IDS = new Set([8]);
const FAR_PRODUCT_IDS = new Set([10]);
const TRAPPING_KEYWORDS = ['trapping', 'trap'];
const FAR_KEYWORDS = ['full attic', 'insulation', 'far', 'blow-in'];
const CLOSEOUT_FORM = 'CLOSE-OUT CHECKLIST FORM';
const FAR_FORM = 'Insulation Blow-In Checklist';

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
  if (['501','674','479','541','542','624'].includes(serviceID)) return true;
  return items.some(item =>
    FAR_PRODUCT_IDS.has(Number(item.productID)) ||
    FAR_KEYWORDS.some(k => item.description?.toLowerCase().includes(k))
  );
}

async function syncDispatch(office: string, key: string, token: string) {
  let updated = 0, errors = 0;

  // Get all active dispatch jobs
  const jobs = await prisma.dispatchJob.findMany({
    where: { office, status: 'ACTIVE' },
    include: {
      customer: { select: { id: true, externalId: true } },
      invoice: { select: { id: true, externalId: true } },
    },
  });

  if (jobs.length === 0) return { updated: 0, errors: 0 };
  console.log(`[${office}] Syncing ${jobs.length} dispatch jobs...`);

  // Build lookup maps
  const customerFRIds = [...new Set(jobs.map(j => j.customer?.externalId).filter(Boolean))];
  const ticketIds = [...new Set(jobs.map(j => j.invoice?.externalId).filter(Boolean))];
  const jobByCustomer = new Map<string, typeof jobs[0][]>();
  const jobByTicket = new Map<string, typeof jobs[0]>();

  for (const job of jobs) {
    if (job.customer?.externalId) {
      const arr = jobByCustomer.get(job.customer.externalId) || [];
      arr.push(job);
      jobByCustomer.set(job.customer.externalId, arr);
    }
    if (job.invoice?.externalId) {
      jobByTicket.set(job.invoice.externalId, job);
    }
  }

  // ============================================================
  // STEP 1: Fetch all tickets to get line items (hasTrapping, hasFAR)
  // ============================================================
  console.log(`[${office}] Fetching ${ticketIds.length} tickets...`);
  const tickets = await fetchInBatches('ticket/get', 'ticketIDs', ticketIds, key, token);
  const ticketMap = new Map<string, any>();
  for (const t of tickets) ticketMap.set(String(t.ticketID), t);

  // ============================================================
  // STEP 2: Fetch all exclusion appointments since 2026-01-01
  // ============================================================
  console.log(`[${office}] Fetching exclusion appointments...`);
  const exclSearch = await frFetch('appointment/search', 'dateStart=2026-01-01', key, token);
  const exclIds: number[] = exclSearch.appointmentIDs || [];
  const allAppts = await fetchInBatches('appointment/get', 'appointmentIDs', exclIds, key, token);

  // Filter exclusion appointments (completed)
  const exclusionAppts = allAppts.filter((a: any) =>
    EXCLUSION_APPT_TYPES.has(String(a.type)) && a.status === '1'
  );
  // Filter trap check appointments (completed)
  const trapAppts = allAppts.filter((a: any) =>
    TRAP_CHECK_APPT_TYPES.has(String(a.type)) && a.status === '1'
  );

  // Build maps: customerID → appointments
  const exclusionByCustomer = new Map<string, any[]>();
  for (const a of exclusionAppts) {
    const arr = exclusionByCustomer.get(String(a.customerID)) || [];
    arr.push(a);
    exclusionByCustomer.set(String(a.customerID), arr);
  }
  const trapByCustomer = new Map<string, any[]>();
  for (const a of trapAppts) {
    const arr = trapByCustomer.get(String(a.customerID)) || [];
    arr.push(a);
    trapByCustomer.set(String(a.customerID), arr);
  }

  // ============================================================
  // STEP 3: Fetch all forms for customers with dispatch jobs
  // ============================================================
  console.log(`[${office}] Fetching forms for ${customerFRIds.length} customers...`);
  const closeOutByCustomer = new Map<string, any>();
  const farByCustomer = new Map<string, any>();

  // Fetch forms in batches of 100 customers
  for (let i = 0; i < customerFRIds.length; i += 100) {
    const batch = customerFRIds.slice(i, i + 100);
    for (const custId of batch) {
      try {
        const formSearch = await frFetch('form/search', `customerID=${custId}`, key, token);
        const formIds = formSearch.formIDs || [];
        if (formIds.length > 0) {
          const formData = await frFetch('form/get', `contractIDs=${formIds.join(',')}`, key, token);
          const forms = formData.forms ? Object.values(formData.forms) : [];
          const closeOut = forms.find((f: any) => f.formDescription === CLOSEOUT_FORM && ['COMPLETED', 'WIP'].includes(f.documentState));
          const far = forms.find((f: any) => f.formDescription === FAR_FORM && ['COMPLETED', 'WIP'].includes(f.documentState));
          if (closeOut) closeOutByCustomer.set(String(custId), closeOut);
          if (far) farByCustomer.set(String(custId), far);
        }
      } catch { /* skip */ }
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`[${office}] Close-out forms found: ${closeOutByCustomer.size}, FAR forms: ${farByCustomer.size}`);

  // ============================================================
  // STEP 4: Update each dispatch job
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

      // Exclusion done?
      const custExclusionAppts = exclusionByCustomer.get(custFRId) || [];
      const exclusionDone = custExclusionAppts.length > 0;
      const latestExclusion = custExclusionAppts.sort((a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      )[0];
      const exclusionDate = latestExclusion ? new Date(latestExclusion.date) : job.exclusionDate;

      // Trap checks
      const custTrapAppts = trapByCustomer.get(custFRId) || [];
      const trapCheckCount = custTrapAppts.length;
      const latestTrap = custTrapAppts.sort((a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      )[0];
      const lastTrapCheck = latestTrap ? new Date(latestTrap.date) : job.lastTrapCheck;

      // Forms
      const closeOutForm = closeOutByCustomer.get(custFRId);
      const farForm = farByCustomer.get(custFRId);

      let closedOut = job.closedOut;
      let closedOutDate = job.closedOutDate;
      let farDone = job.farDone;
      let farDate = job.farDate;
      let jobStatus = job.status;

      if (closeOutForm && !closedOut) {
        closedOut = true;
        closedOutDate = new Date(closeOutForm.dateSigned);
      }
      if (farForm) {
        farDone = true;
        farDate = new Date(farForm.dateSigned);
        closedOut = true;
        closedOutDate = closedOutDate || new Date(farForm.dateSigned);
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
          farDone,
          farDate,
          closedOut,
          closedOutDate,
          status: jobStatus,
        },
      });

      // Update invoice due date if closed out
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
      console.error(`[${office}] Error:`, err.message);
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
