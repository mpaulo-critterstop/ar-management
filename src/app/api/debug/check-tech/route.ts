import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const empId = sp.get('empId') || '10822';
  const from = sp.get('from') || '2026-11-09', to = sp.get('to') || '2026-11-15';
  const out: any = { empId, from, to, offices: {} };
  for (const [office, c] of Object.entries(FR_OFFICES)) {
    if (!c.key) continue;
    const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
    const eg = await (await fetch(`${FR_BASE}/employee/get?employeeIDs=${empId}&${auth}`)).json().catch(()=>null);
    if (!eg?.employees?.length) continue;
    const emp = eg.employees[0];
    const s = `${from} 00:00:00`, e = `${to} 23:59:59`;
    // own GPS?
    const locJson = await (await fetch(`${FR_BASE}/employeeLocation/search?employeeID=${encodeURIComponent(JSON.stringify({operator:'=',value:empId}))}&time=${encodeURIComponent(JSON.stringify({operator:'BETWEEN',value:[s,e]}))}&${auth}`)).json().catch(()=>null);
    // own appointments (servicedBy)?
    const apJson = await (await fetch(`${FR_BASE}/appointment/search?date=${encodeURIComponent(JSON.stringify({operator:'BETWEEN',value:[from,to]}))}&servicedBy=${empId}&${auth}`)).json().catch(()=>null);
    // own clock punches?
    const tcJson = await (await fetch(`${FR_BASE}/timeClock/search?employeeIDs=${empId}&timeIn=${encodeURIComponent(JSON.stringify({operator:'BETWEEN',value:[s,e]}))}&${auth}`)).json().catch(()=>null);
    // routes where he is a tech? route/search by date + assignedTech
    const rtJson = await (await fetch(`${FR_BASE}/route/search?date=${encodeURIComponent(JSON.stringify({operator:'BETWEEN',value:[from,to]}))}&${auth}`)).json().catch(()=>null);
    out.offices[office] = {
      employee: `${emp.fname} ${emp.lname}`,
      ownGpsCount: locJson?.count ?? 0,
      ownApptCount: apJson?.count ?? 0,
      ownClockIDs: tcJson?.count ?? 0,
      routeSearchKeys: rtJson ? Object.keys(rtJson) : null,
      routeCount: rtJson?.count ?? 0,
      routeIgnored: rtJson?.ignoredParams,
    };
  }
  return NextResponse.json(out);
}
