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

  // Check all CStat routes for Jun 6-12 to find where 10838 appears as additionalTechs
  const devinRoutes = routes.filter((r: any) => String(r.assignedTech) === '10838');
  const routesWithDevinAsAdditional = routes.filter((r: any) => {
    const addl = r.additionalTechs;
    if (!addl) return false;
    const addlStr = JSON.stringify(addl);
    return addlStr.includes('10838');
  });

  results.push({
    step: 'Devin as primary tech',
    count: devinRoutes.length,
    total_spots: 'checking...'
  });

  results.push({
    step: 'Routes where Devin is additional tech',
    count: routesWithDevinAsAdditional.length,
    routes: routesWithDevinAsAdditional.map((r: any) => ({
      id: r.routeID,
      date: r.date,
      assignedTech: r.assignedTech,
      additionalTechs: r.additionalTechs
    }))
  });

  // Also check a sample of routes with non-null additionalTechs
  const routesWithAdditional = routes.filter((r: any) => r.additionalTechs);
  results.push({
    step: 'Routes with any additionalTechs',
    count: routesWithAdditional.length,
    sample: routesWithAdditional.slice(0, 3).map((r: any) => ({
      id: r.routeID,
      assignedTech: r.assignedTech,
      additionalTechs: r.additionalTechs
    }))
  });

  return NextResponse.json(results);
}
