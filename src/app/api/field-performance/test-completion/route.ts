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

  // Devin Canter frEmployeeId = 10838 — get his routes for Jun 6-12
  const routeSearchUrl = `${BASE_URL}/route/search?officeIDs=4&dateStart=2026-06-06&dateEnd=2026-06-12&authenticationKey=${key}&authenticationToken=${token}`;
  const routeSearch = await fetch(routeSearchUrl);
  const routeData = await routeSearch.json();
  const allRouteIds: number[] = routeData.routeIDs || [];

  const routeDetailUrl = `${BASE_URL}/route/get?routeIDs=${allRouteIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const routeDetail = await fetch(routeDetailUrl);
  const routeDetailData = await routeDetail.json();
  const propName = routeDetailData.propertyName;
  const routes: any[] = propName && routeDetailData[propName] ? Object.values(routeDetailData[propName] as object) : [];

  const devinRoutes = routes.filter((r: any) => String(r.assignedTech) === '10838');
  results.push({
    step: 'Devin routes',
    count: devinRoutes.length,
    routes: devinRoutes.map((r: any) => ({
      id: r.routeID,
      date: r.date,
      additionalTechs: r.additionalTechs
    }))
  });

  // Get spots per route
  for (const route of devinRoutes) {
    const spotSearchUrl = `${BASE_URL}/spot/search?officeIDs=4&routeIDs=${route.routeID}&authenticationKey=${key}&authenticationToken=${token}`;
    const spotSearch = await fetch(spotSearchUrl);
    const spotSearchData = await spotSearch.json();
    const spotIds: number[] = spotSearchData.spotIDs || [];

    if (spotIds.length > 0) {
      const spotDetailUrl = `${BASE_URL}/spot/get?spotIDs=${spotIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
      const spotDetail = await fetch(spotDetailUrl);
      const spotDetailData = await spotDetail.json();
      const sPropName = spotDetailData.propertyName;
      const spots: any[] = sPropName && spotDetailData[sPropName] ? Object.values(spotDetailData[sPropName] as object) : [];
      const withAppts = spots.filter((s: any) => (s.appointmentIDs || []).length > 0 || s.currentAppointment);
      results.push({ routeID: route.routeID, date: route.date, totalSpots: spots.length, withAppts: withAppts.length });
    }
  }

  return NextResponse.json(results);
}
