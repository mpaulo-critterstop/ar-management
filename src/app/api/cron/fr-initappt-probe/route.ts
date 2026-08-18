// READ-ONLY diagnostic for the initial-service-date bug. Given a subscriptionID, dump the sub's key date
// fields + the RAW initial appointment record, so we can see why the wrong date is being stored.
//   /api/cron/fr-initappt-probe?token=critterstop2026&office=DFW&sub=349
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};
async function frGet(ep: string, params: string, key: string, token: string) {
  const r = await fetch(`${FR_BASE}/${ep}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return r.json();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const sub = sp.get('sub');
  const cfg = OFFICES[office];
  if (!cfg?.key || !sub) return NextResponse.json({ error: 'need office + sub' }, { status: 400 });

  const sr = await frGet('subscription/get', `subscriptionIDs=${sub},${sub}`, cfg.key, cfg.token);
  const s = (sr?.subscriptions || [])[0];
  if (!s) return NextResponse.json({ error: 'subscription not found', raw: sr });

  const out: any = {
    subscriptionID: s.subscriptionID, dateAdded: s.dateAdded, lastCompleted: s.lastCompleted,
    frequency: s.frequency,
    // FR's own next-service fields — compare against our formula (lastCompleted + frequency).
    nextService: s.nextService, nextAppointmentDueDate: s.nextAppointmentDueDate, renewalDate: s.renewalDate,
    ourComputedDue: (() => {
      const lm = String(s.lastCompleted || '').match(/(\d{4})-(\d{2})-(\d{2})/);
      const f = Number(s.frequency) || 0;
      if (!lm || !f) return null;
      const base = new Date(Date.UTC(+lm[1], +lm[2] - 1, +lm[3], 12));
      return new Date(base.getTime() + f * 86400000).toISOString().slice(0, 10);
    })(),
    initialAppointmentID: s.initialAppointmentID, initialStatus: s.initialStatus, initialStatusText: s.initialStatusText,
    serviceType: s.serviceType,
    appointmentIDs_first5: (s.appointmentIDs || '').split(',').slice(0, 5),
    completedAppointmentIDs_first5: (s.completedAppointmentIDs || '').split(',').slice(0, 5),
  };

  // Fetch the initial appointment raw.
  if (s.initialAppointmentID && s.initialAppointmentID !== '0') {
    const ar = await frGet('appointment/get', `appointmentIDs=${s.initialAppointmentID},${s.initialAppointmentID}`, cfg.key, cfg.token);
    const a = (ar?.appointments || [])[0];
    out.initialAppointment_raw = a || ar;
    if (a) out.initialAppointment_dateFields = {
      status: a.status, statusText: a.statusText, date: a.date, start: a.start,
      dateCompleted: a.dateCompleted, checkIn: a.checkIn, checkOut: a.checkOut, dateUpdated: a.dateUpdated,
    };
  }
  return NextResponse.json(out);
}
