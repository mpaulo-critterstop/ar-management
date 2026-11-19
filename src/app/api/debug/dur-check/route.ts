import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  // sample several active 533s to see the distribution of 'duration' + soldBy
  const s = await fetch(`${FR_BASE}/subscription/search?${auth}&officeIDs=1&active=1&serviceID=533`).then(r => r.json()).catch(() => null);
  const ids = (s?.subscriptionIDs || []).slice(0, 20);
  const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${ids.join(',')}`).then(r => r.json()).catch(() => null);
  const subs = g?.subscriptions || [];
  const durDist: Record<string, number> = {};
  for (const x of subs) { const d = String(x.duration); durDist[d] = (durDist[d] || 0) + 1; }
  // show soldBy field + whether salesRep exists
  const sample = subs.slice(0, 3).map((x: any) => ({ id: x.subscriptionID, duration: x.duration, soldBy: x.soldBy, soldBy2: x.soldBy2, salesRep: x.salesRep }));
  return NextResponse.json({ durationDistribution: durDist, sample, allKeysHaveSalesRep: subs[0] ? ('salesRep' in subs[0]) : null });
}
