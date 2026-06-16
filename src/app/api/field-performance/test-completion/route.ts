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

  // Test: can we get all spots for CStat for the week in one call?
  const tests = [
    { param: 'spot/search by office+date', url: `${BASE_URL}/spot/search?officeIDs=4&dateStart=2026-06-06&dateEnd=2026-06-12&${auth}` },
    { param: 'spot/search by office+date (scheduledStart)', url: `${BASE_URL}/spot/search?officeIDs=4&scheduledStart=2026-06-06&scheduledEnd=2026-06-12&${auth}` },
    { param: 'spot/search multiple routeIDs', url: `${BASE_URL}/spot/search?officeIDs=4&routeIDs=56588,56419,56420&${auth}` },
  ];

  for (const t of tests) {
    const res = await fetch(t.url);
    const data = await res.json();
    results.push({
      param: t.param,
      success: data.success,
      count: data.count,
      spot_ids: (data.spotIDs || []).length,
      ignoredParams: data.ignoredParams,
      errorMessage: data.errorMessage,
    });
  }
  return NextResponse.json(results);
}
