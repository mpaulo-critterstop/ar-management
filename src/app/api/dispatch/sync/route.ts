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
const EXCLUSION_APPT_IDS = new Set(['553', '716']);
const TRAP_CHECK_APPT_IDS = new Set(['504', '636']);
const TRAPPING_PRODUCTS = new Set([8]);
const FAR_PRODUCTS = new Set([10]);
const TRAPPING_DESCRIPTIONS = ['trapping', 'trap'];
const FAR_DESCRIPTIONS = ['full attic', 'insulation', 'far', 'blow-in'];
const CLOSEOUT_FORM = 'CLOSE-OUT CHECKLIST FORM';
const FAR_FORM = 'Insulation Blow-In Checklist';

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url);
  return res.json();
}

function hasTrappingItems(items: any[]): boolean {
  return items.some(item =>
    TRAPPING_PRODUCTS.has(Number(item.productID)) ||
    TRAPPING_DESCRIPTIONS.some(d => item.description?.toLowerCase().includes(d))
  );
}

function hasFARItems(items: any[]): boolean {
  return items.some(item =>
    FAR_PRODUCTS.has(Number(item.productID)) ||
    FAR_DESCRIPTIONS.some(d => item.description?.toLowerCase().includes(d))
  );
}

async function syncDispatch(office: string, key: string, token: string) {
  let updated = 0, errors = 0;

  // Get all active dispatch jobs for this office
  const jobs = await prisma.dispatchJob.findMany({
    where: { office, status: 'ACTIVE' },
    include: {
      customer: { select: { id: true, externalId: true } },
      invoice: { select: { id: true, externalId: true } },
    },
  });

  console.log(`[${office}] Syncing ${jobs.length} dispatch jobs...`);

  for (const job of jobs) {
    try {
      if (!job.customer?.externalId || !job.invoice?.externalId) continue;

      const customerFRId = job.customer.externalId;
      const ticketId = job.invoice.externalId;

      // 1. Fetch ticket line items to determine hasTrapping and hasFAR
      const ticketData = await frFetch('ticket/get', `ticketIDs=${ticketId}`, key, token);
      const ticket = ticketData.tickets?.[0];
      if (!ticket) continue;

      const items = ticket.items || [];
      const hasTrapping = hasTrappingItems(items) || ticket.serviceID === '720';
      const hasFAR = hasFARItems(items);

      // 2. Fetch appointments for this customer
      const apptSearch = await frFetch('appointment/search', `customerID=${customerFRId}`, key, token);
      const apptIds = apptSearch.appointmentIDs || [];
      
      let exclusionDone = job.exclusionDone;
      let exclusionDate = job.exclusionDate;
      let trapCheckCount = 0;
      let lastTrapCheck = job.lastTrapCheck;

      if (apptIds.length > 0) {
        const apptData = await frFetch('appointment/get', `appointmentIDs=${apptIds.slice(0, 50).join(',')}`, key, token);
        const appointments = apptData.appointments || [];

        // Check exclusion appointments (completed)
        const exclusionAppts = appointments.filter((a: any) =>
          EXCLUSION_APPT_IDS.has(String(a.type)) && a.status === '1'
        );
        if (exclusionAppts.length > 0) {
          exclusionDone = true;
          const latest = exclusionAppts.sort((a: any, b: any) => 
            new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0];
          exclusionDate = new Date(latest.date);
        }

        // Count trap check appointments (completed)
        const trapAppts = appointments.filter((a: any) =>
          TRAP_CHECK_APPT_IDS.has(String(a.type)) && a.status === '1'
        );
        trapCheckCount = trapAppts.length;
        if (trapAppts.length > 0) {
          const latestTrap = trapAppts.sort((a: any, b: any) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0];
          lastTrapCheck = new Date(latestTrap.date);
        }
      }

      // 3. Fetch forms for close-out and FAR completion
      const formSearch = await frFetch('form/search', `customerID=${customerFRId}`, key, token);
      const formIds = formSearch.formIDs || [];

      let closedOut = job.closedOut;
      let closedOutDate = job.closedOutDate;
      let farDone = job.farDone;
      let farDate = job.farDate;
      let jobStatus = job.status;

      if (formIds.length > 0) {
        const formData = await frFetch('form/get', `contractIDs=${formIds.join(',')}`, key, token);
        const forms = formData.forms || [];

        // Check close-out form
        const closeOutForm = forms.find((f: any) =>
          f.formDescription === CLOSEOUT_FORM && f.documentState === 'COMPLETED'
        );
        if (closeOutForm && !closedOut) {
          closedOut = true;
          closedOutDate = new Date(closeOutForm.dateSigned);
        }

        // Check FAR form
        const farForm = forms.find((f: any) =>
          f.formDescription === FAR_FORM && f.documentState === 'COMPLETED'
        );
        if (farForm && !farDone) {
          farDone = true;
          farDate = new Date(farForm.dateSigned);
          closedOut = true;
          closedOutDate = new Date(farForm.dateSigned);
        }
      }

      // 4. Determine if job should be closed
      // Close if: exclusion done + no trapping + no FAR
      if (exclusionDone && !hasTrapping && !hasFAR) {
        closedOut = true;
        closedOutDate = closedOutDate || exclusionDate || new Date();
      }
      
      if (closedOut) jobStatus = 'CLOSED';

      // 5. Update dispatch job
      await prisma.dispatchJob.update({
        where: { id: job.id },
        data: {
          hasTrapping,
          hasFAR,
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

      // 6. If closed out, update invoice due date in AR (trigger aging)
      if (closedOut && closedOutDate && job.invoice?.id) {
        const existingInvoice = await prisma.invoice.findUnique({
          where: { id: job.invoice.id },
          select: { due: true },
        });
        if (!existingInvoice?.due) {
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
      console.error(`[${office}] Error syncing job ${job.id}:`, err.message);
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
