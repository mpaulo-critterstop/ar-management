import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  const subId = '56738';
  if (sp.get('fix') === '1') {
    const qs = `subscriptionID=${subId}&duration=-1&expirationDate=2029-11-16&soldBy=10818`;
    const r = await fetch(`${FR_BASE}/subscription/update?${auth}&${qs}`, { method: 'POST' });
    const resp = await r.json().catch(() => null);
    const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${subId},${subId}`).then(r => r.json()).catch(() => null);
    const s = (g?.subscriptions || [])[0] || {};
    return NextResponse.json({ updateSuccess: resp?.success, errorMessage: resp?.errorMessage,
      verify: { duration: s.duration, expirationDate: s.expirationDate, soldBy: s.soldBy, nextService: s.nextService, agreementLength: s.agreementLength, recurringCharge: s.recurringCharge, frequency: s.frequency } });
  }
  const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${subId},${subId}`).then(r => r.json()).catch(() => null);
  const s = (g?.subscriptions || [])[0] || {};
  return NextResponse.json({ current: { duration: s.duration, expirationDate: s.expirationDate, soldBy: s.soldBy, nextService: s.nextService }, note: 'add &fix=1 to apply duration=-1, exp=2029-11-16, soldBy=10818' });
}
