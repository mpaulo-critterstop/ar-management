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
  const cynthiaRouteIds = '56588,56423,56422,56421,56420,56419';
  const bulkSpotUrl = `${BASE_URL}/spot/search?officeIDs=4&routeIDs=${cynthiaRouteIds}&${auth}`;
  const bulkRes = await fetch(bulkSpotUrl);
  const bulkData = await bulkRes.json();
  const bulkSpotIds: number[] = bulkData.spotIDs || [];

  results.push({ param: 'bulk spot search (6 routes)', count: bulkData.count, spot_ids: bulkSpotIds.length });

  if (bulkSpotIds.length > 0) {
    // Fetch spot details in one batch
    const detailUrl = `${BASE_URL}/spot/get?spotIDs=${bulkSpotIds.slice(0, 100).join(',')}&${auth}`;
    const detailRes = await fetch(detailUrl);
    const detailData = await detailRes.json();
    const propName = detailData.propertyName;
    const spots: any[] = propName && detailData[propName] ? Object.values(detailData[propName] as object) : [];
    const withAppts = spots.filter((s: any) => s.appointmentIDs && s.appointmentIDs.length > 0);
    results.push({ param: 'bulk spot details', total: spots.length, with_appointments: withAppts.length, expected: 33 });
  }

  return NextResponse.json(results);
}
