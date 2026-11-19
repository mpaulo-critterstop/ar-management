import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  const create: Record<string, string> = {
    customerID: '40802', serviceID: '533', frequency: '360', followupService: '360',
    initialCharge: '149.00', recurringCharge: '149.00', agreementLength: '120',
  };
  // Lifetime: NO expirationDate
  const update: Record<string, string> = { nextService: '2027-11-16', customDate: '2027-11-16', duration: '-1', soldBy: '10678' };
  if (sp.get('confirm') !== '1') return NextResponse.json({ dryRun: true, create, update, note: 'LIFETIME: agreementLength 120, NO expiration, skip 504 (has it). add &confirm=1' });
  const qs = Object.entries(create).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(`${FR_BASE}/subscription/create?${auth}&${qs}`, { method: 'POST' });
  const cr = await r.json().catch(() => null);
  const ss = await fetch(`${FR_BASE}/subscription/search?${auth}&customerIDs=40802`).then(r => r.json()).catch(() => null);
  const sids = ss?.subscriptionIDs || [];
  let newId = null;
  if (sids.length) { const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${sids.join(',')}${sids.length === 1 ? ',' + sids[0] : ''}`).then(r => r.json()).catch(() => null); const s533 = (g?.subscriptions || []).filter((s: any) => String(s.serviceID) === '533').sort((a: any, b: any) => String(b.dateAdded).localeCompare(String(a.dateAdded))); newId = s533[0]?.subscriptionID || null; }
  let verify = null;
  if (newId) {
    const uq = `subscriptionID=${newId}&` + Object.entries(update).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    await fetch(`${FR_BASE}/subscription/update?${auth}&${uq}`, { method: 'POST' });
    const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${newId},${newId}`).then(r => r.json()).catch(() => null);
    const s = (g?.subscriptions || [])[0] || {};
    verify = { id: s.subscriptionID, serviceID: s.serviceID, type: s.serviceType, active: s.active, nextService: s.nextService, recurringCharge: s.recurringCharge, duration: s.duration, agreementLength: s.agreementLength, expirationDate: s.expirationDate, soldBy: s.soldBy };
  }
  return NextResponse.json({ createSuccess: cr?.success, newSubscriptionID: newId, verify });
}
