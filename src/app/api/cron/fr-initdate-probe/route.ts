// READ-ONLY diagnostic for the initial-service-date bug. For given subscription IDs, dumps the sub's
// key dates + the RAW initial appointment object so we can see which field holds the true initial
// completion date (and why some subs show a recent/August date instead of their real initial).
//
//   /api/cron/fr-initdate-probe?token=critterstop2026&office=DFW&subs=349,411,455
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  const subs = (sp.get('subs') || '').split(',').map(s => s.trim()).filter(Boolean);
  const cfg = OFFICES[office];
  if (!cfg?.key) return NextResponse.json({ error: 'unknown office' }, { status: 400 });
  if (!subs.length) return NextResponse.json({ error: 'pass ?subs=id1,id2' }, { status: 400 });

  const subParam = subs.length === 1 ? `${subs[0]},${subs[0]}` : subs.join(',');
  const subRes = await frGet('subscription/get', `subscriptionIDs=${subParam}`, cfg.key, cfg.token);
  const subObjs: any[] = subRes?.subscriptions || [];

  const out: any[] = [];
  for (const s of subObjs) {
    const initApptId = String(s.initialAppointmentID);
    let initAppt: any = null;
    if (initApptId && initApptId !== '0') {
      const r = await frGet('appointment/get', `appointmentIDs=${initApptId},${initApptId}`, cfg.key, cfg.token);
      initAppt = (r?.appointments || [])[0] || null;
    }
    out.push({
      subscriptionID: s.subscriptionID,
      dateAdded: s.dateAdded,
      lastCompleted: s.lastCompleted,
      initialAppointmentID: s.initialAppointmentID,
      // all date-ish fields from the initial appointment, so we can see which is the true initial date
      initialAppointment: initAppt ? {
        appointmentID: initAppt.appointmentID,
        status: initAppt.status, statusText: initAppt.statusText,
        date: initAppt.date, start: initAppt.start, end: initAppt.end,
        dateCompleted: initAppt.dateCompleted, checkIn: initAppt.checkIn, checkOut: initAppt.checkOut,
        dateAdded: initAppt.dateAdded, dateUpdated: initAppt.dateUpdated,
        allKeys: Object.keys(initAppt).filter(k => /date|time|complet|check|start|end/i.test(k)),
      } : 'NOT FOUND',
    });
  }
  return NextResponse.json({ office, count: out.length, subs: out });
}
