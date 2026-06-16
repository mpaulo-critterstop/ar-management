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
  
  // Test each route separately to verify spot counts
  const cynthiaRoutes = [
    { id: '56588', date: '06/07', expected_scheduled: 1 },
    { id: '56419', date: '06/08', expected_scheduled: 8 },
    { id: '56420', date: '06/09', expected_scheduled: 8 },
    { id: '56421', date: '06/10', expected_scheduled: 6 },
    { id: '56422', date: '06/11', expected_scheduled: 8 },
    { id: '56423', date: '06/12', expected_scheduled: 2 },
  ];

  for (const route of cynthiaRoutes) {
    const spotSearchUrl = `${BASE_URL}/spot/search?officeIDs=4&routeIDs=${route.id}&${auth}`;
    const spotRes = await fetch(spotSearchUrl);
    const spotData = await spotRes.json();
    const spotIds: number[] = spotData.spotIDs || [];

    let withAppts = 0;
    if (spotIds.length > 0) {
      const detailUrl = `${BASE_URL}/spot/get?spotIDs=${spotIds.join(',')}&${auth}`;
      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json();
      const propName = detailData.propertyName;
      const spots: any[] = propName && detailData[propName] ? Object.values(detailData[propName] as object) : [];
      withAppts = spots.filter((s: any) => s.appointmentIDs && s.appointmentIDs.length > 0).length;
    }

    results.push({ route: route.id, date: route.date, total_spots: spotIds.length, with_appointments: withAppts, expected: route.expected_scheduled, match: withAppts === route.expected_scheduled });
  }
  return NextResponse.json(results);
}
