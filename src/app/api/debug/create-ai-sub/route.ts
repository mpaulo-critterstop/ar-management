import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  const params: Record<string, string> = {
    customerID: '52568', serviceID: '533', frequency: '360', followupService: '360',
    nextService: '2027-11-17', initialCharge: '149.00', recurringCharge: '149.00',
    duration: '60', agreementLength: '36', expirationDate: '2029-11-17',
  };
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  if (sp.get('confirm') !== '1') return NextResponse.json({ dryRun: true, wouldSend: params, note: 'add &confirm=1 to create' });
  const r = await fetch(`${FR_BASE}/subscription/create?${auth}&${qs}`, { method: 'POST' });
  const createResp = await r.json().catch(() => null);
  const newId = createResp?.subscriptionID || createResp?.subscriptionIDs?.[0] || null;
  let created: any = null;
  if (newId) {
    const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${newId},${newId}`).then(r => r.json()).catch(() => null);
    const s = (g?.subscriptions || [])[0] || {};
    created = {};
    for (const k of ['subscriptionID','customerID','serviceID','serviceType','active','frequency','followupService','nextService','recurringCharge','initialServiceTotal','duration','agreementLength','expirationDate','dateAdded','renewalFrequency']) created[k] = s[k];
  }
  return NextResponse.json({ created: true, newSubscriptionID: newId, createSuccess: createResp?.success, errorMessage: createResp?.errorMessage, verifyReadBack: created });
}
