import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.FIELDROUTES_KEY_CSTAT!;
  const token = process.env.FIELDROUTES_TOKEN_CSTAT!;
  const results: any[] = [];

  // Justin Rogers frEmployeeId = 10583
  // Step 1: Get all CStat routes for Jun 6-12
  const routeSearchUrl = `${BASE_URL}/route/search?officeIDs=4&dateStart=2026-06-06&dateEnd=2026-06-12&authenticationKey=${key}&authenticationToken=${token}`;
  const routeSearch = await fetch(routeSearchUrl);
  const routeData = await routeSearch.json();
  const allRouteIds: number[] = routeData.routeIDs || [];

  const routeDetailUrl = `${BASE_URL}/route/get?routeIDs=${allRouteIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const routeDetail = await fetch(routeDetailUrl);
  const routeDetailData = await routeDetail.json();
  const propName = routeDetailData.propertyName;
  const routes: any[] = propName && routeDetailData[propName] ? Object.values(routeDetailData[propName] as object) : [];
  const justinRoutes = routes.filter((r: any) => String(r.assignedTech) === '10583');
  results.push({ step: '1. Justin routes', count: justinRoutes.length, routeIds: justinRoutes.map((r: any) => ({ id: r.routeID, date: r.date })) });

  // Step 2: For each route, get spots → appointmentIDs
  const allApptIds: number[] = [];
  const apptRouteMap = new Map<number, string>(); // apptID → routeID
  for (const route of justinRoutes) {
    const spotSearchUrl = `${BASE_URL}/spot/search?officeIDs=4&routeIDs=${route.routeID}&authenticationKey=${key}&authenticationToken=${token}`;
    const spotSearch = await fetch(spotSearchUrl);
    const spotData = await spotSearch.json();
    const spotIds: number[] = spotData.spotIDs || [];
    if (spotIds.length === 0) continue;

    const spotDetailUrl = `${BASE_URL}/spot/get?spotIDs=${spotIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
    const spotDetail = await fetch(spotDetailUrl);
    const spotDetailData = await spotDetail.json();
    const sPropName = spotDetailData.propertyName;
    const spots: any[] = sPropName && spotDetailData[sPropName] ? Object.values(spotDetailData[sPropName] as object) : [];
    let routeAppts = 0;
    for (const spot of spots) {
      const ids: number[] = spot.appointmentIDs || [];
      for (const id of ids) { allApptIds.push(id); apptRouteMap.set(id, route.routeID); routeAppts++; }
    }
    results.push({ routeID: route.routeID, date: route.date, appointmentCount: routeAppts });
  }

  results.push({ step: '2. total appointments from spots', count: allApptIds.length });

  // Step 3: Fetch all appointments
  if (allApptIds.length === 0) return NextResponse.json(results);
  const apptUrl = `${BASE_URL}/appointment/get?appointmentIDs=${allApptIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const apptDetail = await fetch(apptUrl);
  const apptDetailData = await apptDetail.json();
  const aPropName = apptDetailData.propertyName;
  const appts: any[] = aPropName && apptDetailData[aPropName] ? Object.values(apptDetailData[aPropName] as object) : [];

  const statusBreakdown: Record<string, number> = {};
  for (const a of appts) {
    const k = `status=${a.status}(${a.statusText || '?'})`;
    statusBreakdown[k] = (statusBreakdown[k] || 0) + 1;
  }
  results.push({ step: '3. status breakdown', total: appts.length, statusBreakdown });

  // Step 4: Filter + completion
  const validAppts = appts.filter((a: any) => String(a.status) !== '-1' && String(a.status) !== '2' && String(a.statusText || '').toLowerCase() !== 'no show');
  const completed = appts.filter((a: any) => String(a.status) === '1').length;
  results.push({ step: '4. completion%', scheduled: allApptIds.length, completed, pct: `${(completed/allApptIds.length*100).toFixed(1)}%` });

  // Step 5: Production value
  const subIds = [...new Set(validAppts.map((a: any) => String(a.subscriptionID)).filter(Boolean))];
  const subUrl = `${BASE_URL}/subscription/get?subscriptionIDs=${subIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const subDetail = await fetch(subUrl);
  const subDetailData = await subDetail.json();
  const subPropName = subDetailData.propertyName;
  const subs: any[] = subPropName && subDetailData[subPropName] ? Object.values(subDetailData[subPropName] as object) : [];

  const subChargeMap = new Map<string, number>();
  for (const s of subs) {
    const recurring = parseFloat(s.recurringCharge || '0');
    const initial = parseFloat(s.initialServiceTotal || '0');
    subChargeMap.set(String(s.subscriptionID), recurring > 0 ? recurring : initial);
  }

  let productionValue = 0;
  const perRoute: Record<string, number> = {};
  for (const a of validAppts) {
    const charge = subChargeMap.get(String(a.subscriptionID)) || 0;
    productionValue += charge;
    const routeId = apptRouteMap.get(parseInt(a.appointmentID)) || 'unknown';
    perRoute[routeId] = (perRoute[routeId] || 0) + charge;
  }
  results.push({ step: '5. production value', productionValue: productionValue.toFixed(2), perRoute });

  return NextResponse.json(results);
}
