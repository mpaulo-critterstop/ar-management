import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const empId = sp.get('empId') || '10822';
  const date = sp.get('date') || '2026-11-10';
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  // routes for the day
  const rtS = await (await fetch(`${FR_BASE}/route/search?date=${encodeURIComponent(JSON.stringify({operator:'=',value:date}))}&${auth}`)).json().catch(()=>null);
  const rtIds = (rtS?.routeIDs||[]).slice(0,60);
  const rtG = await (await fetch(`${FR_BASE}/route/get?routeIDs=${rtIds.join(',')}&${auth}`)).json().catch(()=>null);
  const routes = rtG?.routes || [];
  // find routes mentioning this emp (assignedTech, additionalTechs, etc.)
  const sample = routes[0] ? Object.keys(routes[0]) : [];
  const mine = routes.filter((r:any)=> JSON.stringify(r).includes(empId));
  return NextResponse.json({
    date, routeCount: routes.length, routeKeys: sample,
    routesMentioningEmp: mine.map((r:any)=>({ routeID: r.routeID, assignedTech: r.assignedTech, additionalTechs: r.additionalTechs, title: r.title, date: r.date })),
    firstRouteSample: routes[0] ? { routeID: routes[0].routeID, assignedTech: routes[0].assignedTech, additionalTechs: routes[0].additionalTechs, title: routes[0].title } : null,
  });
}
