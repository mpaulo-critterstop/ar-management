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

  // Try multiple date param combinations
  const tests = [
    `${BASE_URL}/reservice/search?officeIDs=4&dateStart=2026-06-06&dateEnd=2026-06-12&${auth}`,
    `${BASE_URL}/reservice/search?officeIDs=4&dateCompletedStart=2026-06-06&dateCompletedEnd=2026-06-12&${auth}`,
    `${BASE_URL}/reservice/search?officeIDs=4&dateUpdatedStart=2026-06-06&dateUpdatedEnd=2026-06-12&${auth}`,
    `${BASE_URL}/reservice/search?officeIDs=4&${auth}`,
  ];

  const results: any[] = [];
  for (const url of tests) {
    const res = await fetch(url);
    const data = await res.json();
    results.push({
      url: url.replace(key, 'KEY').replace(token, 'TOKEN'),
      success: data.success,
      count: data.count,
      errorMessage: data.errorMessage,
      ids_count: (data.reserviceIDs || data.reServiceIDs || []).length,
      keys: Object.keys(data).slice(0, 8),
    });
  }

  return NextResponse.json(results);
}
