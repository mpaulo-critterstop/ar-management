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
    // try updating nextService (+ customDate as a backup field name)
    const qs = `subscriptionID=${subId}&nextService=2027-11-17&customDate=2027-11-17`;
    const r = await fetch(`${FR_BASE}/subscription/update?${auth}&${qs}`, { method: 'POST' });
    const resp = await r.json().catch(() => null);
    // read back
    const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${subId},${subId}`).then(r => r.json()).catch(() => null);
    const s = (g?.subscriptions || [])[0] || {};
    return NextResponse.json({ updateSuccess: resp?.success, errorMessage: resp?.errorMessage, nextService: s.nextService, customDate: s.customDate, expirationDate: s.expirationDate, agreementLength: s.agreementLength });
  }
  // just read current state
  const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${subId},${subId}`).then(r => r.json()).catch(() => null);
  const s = (g?.subscriptions || [])[0] || {};
  return NextResponse.json({ nextService: s.nextService, customDate: s.customDate, expirationDate: s.expirationDate, note: 'add &fix=1 to set nextService to 2027-11-17' });
}
