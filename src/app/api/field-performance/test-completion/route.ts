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

  const tests = [
    { param: 'servicedBy',   url: `${BASE_URL}/appointment/search?officeIDs=4&servicedBy=10856&dateStart=2026-06-09&dateEnd=2026-06-09&${auth}` },
    { param: 'assignedTech', url: `${BASE_URL}/appointment/search?officeIDs=4&assignedTech=10856&dateStart=2026-06-09&dateEnd=2026-06-09&${auth}` },
    { param: 'spot/search by routeID', url: `${BASE_URL}/spot/search?officeIDs=4&routeIDs=56420&${auth}` },
    { param: 'spot/search by assignedTech', url: `${BASE_URL}/spot/search?officeIDs=4&assignedTech=10856&dateStart=2026-06-09&dateEnd=2026-06-09&${auth}` },
  ];

  const results = [];
  for (const t of tests) {
    const res = await fetch(t.url);
    const data = await res.json();
    results.push({
      param: t.param,
      success: data.success,
      count: data.count,
      ids_count: (data.appointmentIDs || []).length,
      errorMessage: data.errorMessage,
      ignoredParams: data.ignoredParams,
    });
  }

  return NextResponse.json(results);
}
