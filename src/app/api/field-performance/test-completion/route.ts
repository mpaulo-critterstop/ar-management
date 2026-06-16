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

  const tests: any[] = [
    { param: 'spot/search by routeID', url: `${BASE_URL}/spot/search?officeIDs=4&routeIDs=56420&${auth}` },
  ];

  const results = [];
  for (const t of tests) {
    const res = await fetch(t.url);
    const data = await res.json();
    const spotIds: number[] = data.spotIDs || [];
    results.push({
      param: t.param,
      success: data.success,
      count: data.count,
      spot_ids_count: spotIds.length,
    });

    // Fetch spot details to count those with appointments
    if (spotIds.length > 0) {
      const detailUrl = `${BASE_URL}/spot/get?spotIDs=${spotIds.slice(0,22).join(',')}&${auth}`;
      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json();
      const propName = detailData.propertyName;
      const spots: any[] = propName && detailData[propName] ? Object.values(detailData[propName] as object) : [];
      const withAppts = spots.filter((s: any) => s.appointmentIDs && s.appointmentIDs.length > 0);
      const open = spots.filter((s: any) => s.open === '1' || s.open === 1);
      results.push({
        param: 'spot details',
        total_spots: spots.length,
        spots_with_appointments: withAppts.length,
        open_spots: open.length,
        sample_spot_keys: spots.length > 0 ? Object.keys(spots[0]).slice(0, 10) : [],
      });
    }
  }

  return NextResponse.json(results);
}
