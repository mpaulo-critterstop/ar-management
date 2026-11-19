import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const EXCL = '553';

// Report-only: find completed 553 exclusions in a date window, cross-ref each customer's
// excl_estimate record (guarantee + SL uuid) + existing 533/504 subs. NO writes.
// ?token=critterstop2026 &from=2026-11-16 &to=2026-11-18
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const from = sp.get('from') || '2026-11-16', to = sp.get('to') || '2026-11-18';

  // load stored estimates (frId -> record)
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
  const estByFr: Record<string, any> = {};
  for (const r of rows) { try { const rec = JSON.parse(r.value); if (rec.frCustomerId) estByFr[String(rec.frCustomerId)] = rec; } catch {} }

  const out: any[] = [];
  for (const [office, c] of Object.entries(FR_OFFICES)) {
    if (!c.key) continue;
    const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
    // completed 553 in window: search by dateCompleted + serviceID
    const asRes = await fetch(`${FR_BASE}/appointment/search?${auth}&officeIDs=${c.officeId}&serviceID=${EXCL}&dateCompleted=${encodeURIComponent(JSON.stringify({ operator: 'BETWEEN', value: [`${from} 00:00:00`, `${to} 23:59:59`] }))}`).then(r => r.json()).catch(() => null);
    const aids = (asRes?.appointmentIDs || []).slice(0, 60);
    if (!aids.length) continue;
    const ag = await fetch(`${FR_BASE}/appointment/get?${auth}&appointmentIDs=${aids.join(',')}${aids.length === 1 ? ',' + aids[0] : ''}`).then(r => r.json()).catch(() => null);
    const appts = ag?.appointments || [];
    for (const a of appts) {
      const custId = String(a.customerID);
      // existing subs
      const ss = await fetch(`${FR_BASE}/subscription/search?${auth}&customerIDs=${custId}`).then(r => r.json()).catch(() => null);
      const sids = ss?.subscriptionIDs || [];
      let subs: any[] = [];
      if (sids.length) { const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${sids.join(',')}${sids.length === 1 ? ',' + sids[0] : ''}`).then(r => r.json()).catch(() => null); subs = g?.subscriptions || []; }
      const has533 = subs.some((s: any) => String(s.serviceID) === '533');
      const has504 = subs.some((s: any) => String(s.serviceID) === '504');
      const est = estByFr[custId];
      out.push({
        office, customerID: custId, appointmentID: a.appointmentID, exclusionCompleted: a.dateCompleted,
        hasEstimateRecord: !!est, slUuid: est?.customerUuid || null,
        guarantee: est?.estimate?.guaranteeGroup || null,
        hasTrapping: est?.estimate?.hasTrapping ?? null,
        existing533: has533, existing504: has504,
        wouldCreate533: !has533 && !!est?.estimate?.guaranteeGroup,
        wouldCreate504: !has504 && (est?.estimate?.hasTrapping === true),
      });
    }
  }
  return NextResponse.json({ window: `${from} to ${to}`, completedExclusions: out.length, items: out });
}
