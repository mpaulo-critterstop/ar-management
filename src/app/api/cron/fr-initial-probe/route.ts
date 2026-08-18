// READ-ONLY diagnostic for the initial-service-date bug. Given a subscriptionID (and office), dump the sub's
// key dates + the RAW initial appointment record, so we can see whether initialAppointmentID points at the
// wrong appointment or whether we're reading the wrong date field.
//
//   /api/cron/fr-initial-probe?token=critterstop2026&office=DFW&sub=349
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};
async function frGet(endpoint: string, params: string, key: string, token: string) {
  const res = await fetch(`${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return res.json();
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
  if (!s) return NextResponse.json({ error: 'sub not found', raw: sr });

  const out: any = {
    subscriptionID: s.subscriptionID, dateAdded: s.dateAdded, lastCompleted: s.lastCompleted,
    initialAppointmentID: s.initialAppointmentID,
    initialStatus: s.initialStatus, initialStatusText: s.initialStatusText,
    appointmentIDs: s.appointmentIDs, completedAppointmentIDs: s.completedAppointmentIDs,
  };

  // Fetch the initialAppointmentID record + the FIRST id in appointmentIDs, to compare.
  const firstApptId = (s.appointmentIDs || '').split(',')[0];
  const idsToGet = [...new Set([String(s.initialAppointmentID), firstApptId].filter(x => x && x !== '0'))];
  if (idsToGet.length) {
    const ar = await frGet('appointment/get', `appointmentIDs=${idsToGet.join(',')}${idsToGet.length === 1 ? ',' + idsToGet[0] : ''}`, cfg.key, cfg.token);
    out.appointments = (ar?.appointments || []).map((a: any) => ({
      appointmentID: a.appointmentID, status: a.status, statusText: a.statusText,
      date: a.date, start: a.start, dateCompleted: a.dateCompleted, checkIn: a.checkIn, checkOut: a.checkOut,
      dateAdded: a.dateAdded, type: a.type, serviceID: a.serviceID,
    }));
    out.allApptFieldNames = ar?.appointments?.[0] ? Object.keys(ar.appointments[0]).sort() : null;
  }
  return NextResponse.json(out);
}
