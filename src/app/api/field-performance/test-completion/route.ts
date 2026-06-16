import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.FIELDROUTES_KEY_CSTAT!;
  const token = process.env.FIELDROUTES_TOKEN_CSTAT!;
  const auth = `authenticationKey=${key}&authenticationToken=${token}`;

  // Test: bulk spot search with multiple route IDs (Cynthia's 6 routes for Jun 6-12)
  const results: any[] = [];

  // Jacob Kidd's routes for Jun 6-12 (from the route report)
  // Need to find his route IDs first
  const routeSearchUrl = `${BASE_URL}/route/search?officeIDs=4&dateStart=2026-06-06&dateEnd=2026-06-12&authenticationKey=${key}&authenticationToken=${token}`;
  const routeSearch = await fetch(routeSearchUrl);
  const routeData = await routeSearch.json();
  const allRouteIds: number[] = routeData.routeIDs || [];

  // Get route details to find Jacob's routes (assignedTech=10579)
  const routeDetailUrl = `${BASE_URL}/route/get?routeIDs=${allRouteIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const routeDetail = await fetch(routeDetailUrl);
  const routeDetailData = await routeDetail.json();
  const propName = routeDetailData.propertyName;
  const routes: any[] = propName && routeDetailData[propName] ? Object.values(routeDetailData[propName] as object) : [];
  const jacobRoutes = routes.filter((r: any) => String(r.assignedTech) === '10579');

  results.push({ step: 'Jacob routes', count: jacobRoutes.length, ids: jacobRoutes.map((r: any) => r.routeID) });

  // For each route, get spots and check all appointment statuses
  let totalSpots = 0, spotsWithAppts = 0;
  const apptIdSet = new Set<number>();

  for (const route of jacobRoutes) {
    const spotSearchUrl = `${BASE_URL}/spot/search?officeIDs=4&routeIDs=${route.routeID}&authenticationKey=${key}&authenticationToken=${token}`;
    const spotSearch = await fetch(spotSearchUrl);
    const spotSearchData = await spotSearch.json();
    const spotIds: number[] = spotSearchData.spotIDs || [];
    totalSpots += spotIds.length;

    if (spotIds.length > 0) {
      const spotDetailUrl = `${BASE_URL}/spot/get?spotIDs=${spotIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
      const spotDetail = await fetch(spotDetailUrl);
      const spotDetailData = await spotDetail.json();
      const sPropName = spotDetailData.propertyName;
      const spots: any[] = sPropName && spotDetailData[sPropName] ? Object.values(spotDetailData[sPropName] as object) : [];
      for (const spot of spots) {
        const apptIds: number[] = spot.appointmentIDs || [];
        if (apptIds.length > 0) {
          spotsWithAppts++;
          for (const id of apptIds) apptIdSet.add(id);
        }
      }
    }
  }

  results.push({ step: 'spots summary', totalSpots, spotsWithAppts, uniqueApptIds: apptIdSet.size });

  // Fetch all those appointments and check statuses
  if (apptIdSet.size > 0) {
    const apptIds = [...apptIdSet];
    const apptDetailUrl = `${BASE_URL}/appointment/get?appointmentIDs=${apptIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
    const apptDetail = await fetch(apptDetailUrl);
    const apptDetailData = await apptDetail.json();
    const aPropName = apptDetailData.propertyName;
    const appts: any[] = aPropName && apptDetailData[aPropName] ? Object.values(apptDetailData[aPropName] as object) : [];
    const statusCounts: Record<string, number> = {};
    const servicedByCounts: Record<string, number> = {};
    for (const a of appts) {
      const s = String(a.status);
      const sb = String(a.servicedBy || '0');
      statusCounts[s] = (statusCounts[s] || 0) + 1;
      if (s === '1') servicedByCounts[sb] = (servicedByCounts[sb] || 0) + 1;
    }
    results.push({ step: 'appointments on Jacob spots', total: appts.length, statuses: statusCounts, servicedBy: servicedByCounts });
  }
  return NextResponse.json(results);
}
