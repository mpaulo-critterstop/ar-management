// Annual Inspection (Service 533) reminder automation — daily cron.
// ENROLL: active 533 subscription, NOT scheduled, nextService (due date) <= 15 days away -> fire Pest AI enroll
//         webhook. Pest AI runs the 4-step follow-up sequence, then auto-moves to Forfeit (handled in Pest AI).
// UNENROLL: subscription is now scheduled (nextAppointmentDueDate set) AND we previously enrolled it -> fire
//           Pest AI unenroll webhook so they stop getting reminders once they've booked.
// "Scheduled" = nextAppointmentDueDate is set (NOT appointmentIDs, which keeps cancelled appts).
// State (enrolled subs) tracked in appSetting key 'ai_reminder_state' so we enroll/unenroll once each.
//   GET ?token=critterstop2026            -> run (enroll + unenroll)
//   GET ?token=critterstop2026&dry=1      -> preview, fire nothing
//   GET ?token=critterstop2026&office=DFW -> limit to one office
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};
const ANNUAL_INSPECTION_SERVICE_ID = 533;
const ENROLL_WINDOW_DAYS = 15; // enroll when due date is within this many days
const ENROLL_WEBHOOK   = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/vRKCXGELTEdOmouvg6b3';
const UNENROLL_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/yfO3x7uoxSwZkiaxI4cy';
const STATE_KEY = 'ai_reminder_state';

let chain: Promise<any> = Promise.resolve();
function fr(url: string): Promise<any> {
  const run = chain.then(async () => { await new Promise(r => setTimeout(r, 900)); return fetch(url).then(r => r.json()); });
  chain = run.catch(() => {});
  return run;
}
const fmtDate = (d: string) => { if (!d) return ''; const [y, m, day] = d.slice(0, 10).split('-'); return `${m}/${day}/${y}`; };
const phonePlus = (p: string) => { const r = (p || '').replace(/\D/g, ''); return r ? (r.length === 10 ? `+1${r}` : `+${r}`) : ''; };

async function fire(url: string, payload: any) {
  try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return { ok: r.ok, status: r.status }; }
  catch (e) { return { ok: false, status: 0, error: String(e) }; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const onlyOffice = sp.get('office');
  const offices = onlyOffice ? { [onlyOffice]: OFFICES[onlyOffice] } : OFFICES;

  // Load state: { enrolled: { "<subscriptionID>": { at, dueDate } } }
  const stRow = await prisma.appSetting.findUnique({ where: { key: STATE_KEY } });
  const state = stRow ? JSON.parse(stRow.value) : { enrolled: {} };
  state.enrolled = state.enrolled || {};

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const results: any[] = [];
  let enrolled = 0, unenrolled = 0, scanned = 0;

  for (const [officeName, cfg] of Object.entries(offices)) {
    if (!cfg?.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    // all active subs, then filter to 533 in code (FR serviceIDs filter is unreliable)
    const s = await fr(`${BASE_URL}/subscription/search?${auth}&officeIDs=${cfg.officeId}&active=1`);
    const ids = s.subscriptionIDs || [];
    for (let i = 0; i < ids.length; i += 100) {
      const c = ids.slice(i, i + 100);
      const g = await fr(`${BASE_URL}/subscription/get?${auth}&subscriptionIDs=${c.join(',')}${c.length === 1 ? ',' + c[0] : ''}`);
      for (const sub of (g.subscriptions || [])) {
        if (String(sub.serviceID) !== String(ANNUAL_INSPECTION_SERVICE_ID)) continue;
        scanned++;
        const subId = String(sub.subscriptionID);
        const custId = String(sub.customerID);
        const nextService = String(sub.nextService || '').slice(0, 10);
        // SCHEDULED = nextAppointmentDueDate set (reliable; appointmentIDs keeps cancelled appts)
        const isScheduled = !!(sub.nextAppointmentDueDate && String(sub.nextAppointmentDueDate) !== '0000-00-00');
        const wasEnrolled = !!state.enrolled[subId];

        // UNENROLL: scheduled + we had enrolled them -> pull from sequence
        if (isScheduled && wasEnrolled) {
          const cust = (await fr(`${BASE_URL}/customer/get?${auth}&customerIDs=${custId},${custId}`)).customers?.[0] || {};
          const payload = {
            first_name: cust.fname || '', last_name: cust.lname || '', email: cust.email || '',
            phone: phonePlus(cust.phone1 || cust.phone2 || ''), customerID: custId, subscriptionID: subId,
            address: cust.address || '', city: cust.city || '', state: cust.state || '', zip: cust.zip || '',
            AIDueDate: fmtDate(nextService),
          };
          if (!dry) { await fire(UNENROLL_WEBHOOK, payload); delete state.enrolled[subId]; }
          unenrolled++;
          results.push({ action: 'unenroll', office: officeName, subscriptionID: subId, customer: `${cust.fname || ''} ${cust.lname || ''}`.trim(), reason: 'scheduled' });
          continue;
        }

        // ENROLL: not scheduled, not already enrolled, due within window
        if (!isScheduled && !wasEnrolled && nextService) {
          const due = new Date(nextService + 'T00:00:00Z');
          const days = Math.round((due.getTime() - today.getTime()) / 86400000);
          if (days <= ENROLL_WINDOW_DAYS) {   // within window (includes overdue: days can be negative -> keep reminding)
            const cust = (await fr(`${BASE_URL}/customer/get?${auth}&customerIDs=${custId},${custId}`)).customers?.[0] || {};
            const payload = {
              first_name: cust.fname || '', last_name: cust.lname || '', email: cust.email || '',
              phone: phonePlus(cust.phone1 || cust.phone2 || ''), customerID: custId, subscriptionID: subId,
              address: cust.address || '', city: cust.city || '', state: cust.state || '', zip: cust.zip || '',
              AIDueDate: fmtDate(nextService),
            };
            if (!dry) { await fire(ENROLL_WEBHOOK, payload); state.enrolled[subId] = { at: new Date().toISOString(), dueDate: nextService }; }
            enrolled++;
            results.push({ action: 'enroll', office: officeName, subscriptionID: subId, customer: `${cust.fname || ''} ${cust.lname || ''}`.trim(), dueDate: nextService, daysUntilDue: days });
          }
        }
      }
    }
  }

  if (!dry) await prisma.appSetting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });

  return NextResponse.json({ ok: true, dry, scanned533: scanned, enrolled, unenrolled, currentlyEnrolled: Object.keys(state.enrolled).length, results });
}
