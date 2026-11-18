import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

// Discover how a tech appears: own appointments? routes where they're an additional tech?
// ?token=critterstop2026 &empId=10822 &date=2026-11-10
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const empId = sp.get('empId') || '10822';
  const date = sp.get('date') || '2026-11-10';

  const out: any = { empId, date };
  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!cfg.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const eg = await fetch(`${FR_BASE}/employee/get?employeeIDs=${empId}&${auth}`);
    const ej = await eg.json().catch(() => null);
    if (!ej?.employees?.length) continue;
    out.office = office; out.name = `${ej.employees[0].fname} ${ej.employees[0].lname}`;

    // 1) own appointments
    const ap = await fetch(`${FR_BASE}/appointment/search?date=${encodeURIComponent(JSON.stringify({operator:'=',value:date}))}&servicedBy=${empId}&${auth}`);
    const apj = await ap.json().catch(()=>null);
    out.ownAppointments = apj?.count ?? 0;

    // 2) routes for the day — look for this tech in route's assignedTech / additionalTechs
    const rt = await fetch(`${FR_BASE}/route/search?date=${encodeURIComponent(JSON.stringify({operator:'=',value:date}))}&includeData=1&${auth}`);
    const rtj = await rt.json().catch(()=>null);
    let routes = rtj?.routes || [];
    if ((!routes.length) && (rtj?.routeIDs||[]).length) {
      const g = await fetch(`${FR_BASE}/route/get?routeIDs=${rtj.routeIDs.slice(0,200).join(',')}&${auth}`);
      routes = (await g.json().catch(()=>null))?.routes || [];
    }
    out.routeCount = routes.length;
    // dump the fields of one route to see where techs live
    if (routes.length) out.sampleRouteKeys = Object.keys(routes[0]);
    // find routes mentioning this empId in any tech field
    const mine = routes.filter((r:any) => {
      const blob = JSON.stringify(r);
      return blob.includes(`"${empId}"`) || blob.includes(`:${empId},`) || blob.includes(`:${empId}}`);
    });
    out.routesWithThisTech = mine.map((r:any) => ({
      routeID: r.routeID, title: r.title || r.name,
      assignedTech: r.assignedTech, additionalTechs: r.additionalTechs || r.additionalTechsIDs || r.techIDs,
      totalStops: r.totalStops,
    }));
    break;
  }
  return NextResponse.json(out);
}
