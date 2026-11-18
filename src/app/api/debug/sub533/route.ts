import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const subId = req.nextUrl.searchParams.get('subId');
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  let id = subId;
  if (!id) {
    // find one active 533 to inspect
    const s = await fetch(`${FR_BASE}/subscription/search?${auth}&officeIDs=1&active=1&serviceID=533`).then(r => r.json()).catch(() => null);
    id = (s?.subscriptionIDs || [])[0];
  }
  if (!id) return NextResponse.json({ error: 'no 533 found' });
  const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${id},${id}`).then(r => r.json()).catch(() => null);
  const sub = (g?.subscriptions || [])[0] || {};
  // return all non-empty fields
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(sub)) if (v !== null && v !== '' && v !== '0000-00-00') fields[k] = v;
  return NextResponse.json({ subscriptionID: id, fields });
}
