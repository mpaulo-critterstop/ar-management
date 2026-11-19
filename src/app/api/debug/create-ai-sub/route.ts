import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
// Verify: read David's (52568) subscriptions and show any 533.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  const ss = await fetch(`${FR_BASE}/subscription/search?${auth}&customerIDs=52568`).then(r => r.json()).catch(() => null);
  const ids = (ss?.subscriptionIDs || []);
  let subs: any[] = [];
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${ids.join(',')}${ids.length === 1 ? ',' + ids[0] : ''}`).then(r => r.json()).catch(() => null);
    subs = g?.subscriptions || [];
  }
  const out = subs.map((s: any) => ({
    subscriptionID: s.subscriptionID, serviceID: s.serviceID, serviceType: s.serviceType, active: s.active,
    frequency: s.frequency, followupService: s.followupService, nextService: s.nextService,
    recurringCharge: s.recurringCharge, initialServiceTotal: s.initialServiceTotal, duration: s.duration,
    agreementLength: s.agreementLength, expirationDate: s.expirationDate, dateAdded: s.dateAdded,
  }));
  return NextResponse.json({ customer: 52568, subscriptionCount: out.length, subscriptions: out, the533: out.filter((s: any) => String(s.serviceID) === '533') });
}
