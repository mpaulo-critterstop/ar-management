// READ-ONLY probe for the Service Pool build. Figures out how to identify a PENDING (not-yet-completed,
// not-cancelled) FUTURE appointment in FR, so we can correctly determine "subscription is due but NOT
// scheduled." Does not write anything.
//   /api/cron/fr-appt-probe?token=critterstop2026&office=DFW&from=2026-08-18&to=2026-09-30
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
  const from = sp.get('from') || new Date().toISOString().slice(0, 10);
  const to = sp.get('to') || '2026-12-31';
  const cfg = OFFICES[office];
  if (!cfg?.key) return NextResponse.json({ error: 'unknown office' }, { status: 400 });

  const out: any = { office, from, to };

  // 1) Search appointments by date range — see what search params work + how many come back.
  const range = JSON.stringify({ operator: 'BETWEEN', value: [from, to] });
  const search = await frGet('appointment/search', `date=${encodeURIComponent(range)}`, cfg.key, cfg.token);
  const ids: number[] = search?.appointmentIDs || [];
  out.searchByDate = { ok: search?.success, count: ids.length, keysReturned: search && typeof search === 'object' ? Object.keys(search) : null };

  // 2) Pull a sample and show status distribution + date fields, so we learn which status = pending/future.
  if (ids.length) {
    const sample = ids.slice(0, 50);
    const got = await frGet('appointment/get', `appointmentIDs=${sample.join(',')}`, cfg.key, cfg.token);
    const appts = got?.appointments || [];
    const statusDist: Record<string, number> = {};
    for (const a of appts) {
      const k = `${a.status}|${a.statusText}`;
      statusDist[k] = (statusDist[k] || 0) + 1;
    }
    out.statusDistribution = statusDist; // e.g. {"0|Pending": 30, "1|Completed": 20}
    out.sampleAppointments = appts.slice(0, 5).map((a: any) => ({
      appointmentID: a.appointmentID, subscriptionID: a.subscriptionID, status: a.status, statusText: a.statusText,
      date: a.date, dateCompleted: a.dateCompleted, dateCancelled: a.dateCancelled, type: a.type,
    }));
  }

  return NextResponse.json(out);
}
