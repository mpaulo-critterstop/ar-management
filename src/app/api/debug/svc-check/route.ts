import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  // get ONE known exclusion appt (David's was completed 11/17) + dump all its fields to find the service field
  // David cust 52568; find his 553
  const as = await fetch(`${FR_BASE}/appointment/search?${auth}&customerIDs=52568`).then(r => r.json()).catch(() => null);
  const aids = (as?.appointmentIDs || []);
  const g = await fetch(`${FR_BASE}/appointment/get?${auth}&appointmentIDs=${aids.join(',')}${aids.length===1?','+aids[0]:''}`).then(r => r.json()).catch(() => null);
  const appts = (g?.appointments || []).map((a:any)=>({ id:a.appointmentID, type:a.type, serviceID:a.serviceID, serviceType:a.serviceType, subscriptionID:a.subscriptionID, dateCompleted:a.dateCompleted, duration:a.duration }));
  // also: how to correctly search exclusions? try serviceIDs (plural) which some FR endpoints want
  const s2 = await fetch(`${FR_BASE}/appointment/search?${auth}&officeIDs=1&serviceIDs=553&dateCompleted=${encodeURIComponent(JSON.stringify({operator:'BETWEEN',value:['2026-11-16 00:00:00','2026-11-16 23:59:59']}))}`).then(r=>r.json()).catch(()=>null);
  return NextResponse.json({ davidAppts: appts, davidApptKeys: g?.appointments?.[0] ? Object.keys(g.appointments[0]) : null, serviceIDsPluralCount: s2?.appointmentIDs?.length, serviceIDsPluralIgnored: s2?.ignoredParams });
}
