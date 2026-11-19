import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  // get service type 553 name
  const st = await fetch(`${FR_BASE}/serviceType/get?serviceTypeIDs=553,553&${auth}`).then(r => r.json()).catch(() => null);
  const svc = (st?.serviceTypes || [])[0] || {};
  // sample a few of the 11/16 completed "553" appts to see their actual type/description
  const as = await fetch(`${FR_BASE}/appointment/search?${auth}&officeIDs=1&serviceID=553&dateCompleted=${encodeURIComponent(JSON.stringify({ operator: 'BETWEEN', value: ['2026-11-16 00:00:00', '2026-11-16 23:59:59'] }))}`).then(r => r.json()).catch(() => null);
  const aids = (as?.appointmentIDs || []).slice(0, 5);
  let sampleAppts: any[] = [];
  if (aids.length) { const g = await fetch(`${FR_BASE}/appointment/get?${auth}&appointmentIDs=${aids.join(',')}`).then(r => r.json()).catch(() => null); sampleAppts = (g?.appointments || []).map((a: any) => ({ id: a.appointmentID, type: a.type, serviceID: a.serviceID, servicedBy: a.servicedBy, dateCompleted: a.dateCompleted, duration: a.duration })); }
  return NextResponse.json({ service553: { name: svc.description || svc.name, category: svc.category }, dfwCompleted1116Count: (as?.appointmentIDs || []).length, sampleAppts });
}
