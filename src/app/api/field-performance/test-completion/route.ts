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

  let totalScheduled = 0, totalCompleted = 0, totalPending = 0, totalNoShow = 0;
  let totalProduction = 0;
  const perRoute: any[] = [];

  for (const route of justinRoutes) {
    // Step 1: spots → appointmentIDs
    const spotSearchUrl = `${BASE_URL}/spot/search?officeIDs=4&routeIDs=${route.routeID}&authenticationKey=${key}&authenticationToken=${token}`;
    const spotSearch = await fetch(spotSearchUrl);
    const spotSearchData = await spotSearch.json();
    const spotIds: number[] = spotSearchData.spotIDs || [];
    if (spotIds.length === 0) continue;

    const spotDetailUrl = `${BASE_URL}/spot/get?spotIDs=${spotIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
    const spotDetail = await fetch(spotDetailUrl);
    const spotDetailData = await spotDetail.json();
    const sPropName = spotDetailData.propertyName;
    const spots: any[] = sPropName && spotDetailData[sPropName] ? Object.values(spotDetailData[sPropName] as object) : [];
    const apptIds: number[] = [];
    for (const spot of spots) {
      const ids: number[] = spot.appointmentIDs || [];
      apptIds.push(...ids);
    }
    if (apptIds.length === 0) continue;

    // Step 2: fetch appointments
    const apptUrl = `${BASE_URL}/appointment/get?appointmentIDs=${apptIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
    const apptDetail = await fetch(apptUrl);
    const apptDetailData = await apptDetail.json();
    const aPropName = apptDetailData.propertyName;
    const appts: any[] = aPropName && apptDetailData[aPropName] ? Object.values(apptDetailData[aPropName] as object) : [];

    // Step 3: completion counts
    const completed = appts.filter((a: any) => String(a.status) === '1').length;
    const pending = appts.filter((a: any) => String(a.status) === '0').length;
    const noShow = appts.filter((a: any) => String(a.status) === '2' || String(a.statusText || '').toLowerCase() === 'no show').length;

    // Step 4: split valid appts
    const validAppts = appts.filter((a: any) =>
      String(a.status) !== '-1' &&
      String(a.status) !== '2' &&
      String(a.statusText || '').toLowerCase() !== 'no show'
    );
    const subAppts = validAppts.filter((a: any) => parseInt(a.subscriptionID || '0') > 0);
    const ticketAppts = validAppts.filter((a: any) => parseInt(a.subscriptionID || '0') <= 0 && a.ticketID && String(a.ticketID) !== '0');

    // Step 5: subscription value
    let routeProduction = 0;
    const subIds = [...new Set(subAppts.map((a: any) => String(a.subscriptionID)))];
    if (subIds.length > 0) {
      const subUrl = `${BASE_URL}/subscription/get?subscriptionIDs=${subIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
      const subDetail = await fetch(subUrl);
      const subDetailData = await subDetail.json();
      const subPropName = subDetailData.propertyName;
      const subs: any[] = subPropName && subDetailData[subPropName] ? Object.values(subDetailData[subPropName] as object) : [];
      for (const s of subs) {
        const recurring = parseFloat(s.recurringCharge || '0');
        const initial = parseFloat(s.initialServiceTotal || '0');
        routeProduction += recurring > 0 ? recurring : initial;
      }
    }

    // Step 6: ticket value for standalone appointments
    const ticketIds = [...new Set(ticketAppts.map((a: any) => String(a.ticketID)))];
    if (ticketIds.length > 0) {
      const ticketUrl = `${BASE_URL}/ticket/get?ticketIDs=${ticketIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
      const ticketDetail = await fetch(ticketUrl);
      const ticketDetailData = await ticketDetail.json();
      const tPropName = ticketDetailData.propertyName;
      const tickets: any[] = tPropName && ticketDetailData[tPropName] ? Object.values(ticketDetailData[tPropName] as object) : [];
      for (const t of tickets) routeProduction += parseFloat(t.subTotal || '0');
    }

    totalScheduled += apptIds.length;
    totalCompleted += completed;
    totalPending += pending;
    totalNoShow += noShow;
    totalProduction += routeProduction;

    perRoute.push({
      routeID: route.routeID,
      date: route.date,
      scheduled: apptIds.length,
      completed, pending, noShow,
      production: routeProduction.toFixed(2),
      subAppts: subAppts.length,
      ticketAppts: ticketAppts.length,
    });
  }

  const completionPct = totalScheduled > 0
    ? ((totalCompleted / totalScheduled) * 100).toFixed(1)
    : '0';

  results.push({
    tech: 'Justin Rogers (P-004)',
    totalScheduled, totalCompleted, totalPending, totalNoShow,
    completionPct: completionPct + '%',
    totalProduction: totalProduction.toFixed(2),
    perRoute,
  });

  return NextResponse.json(results);
}
