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

  // Jacob Kidd frEmployeeId = 10579
  // Test different ways to count his scheduled appointments for Jun 6-12
  const tests = [
    { param: 'servicedBy=10579', url: `${BASE_URL}/appointment/search?officeIDs=4&servicedBy=10579&dateStart=2026-06-06&dateEnd=2026-06-12&${auth}` },
    { param: 'assignedTech=10579', url: `${BASE_URL}/appointment/search?officeIDs=4&assignedTech=10579&dateStart=2026-06-06&dateEnd=2026-06-12&${auth}` },
  ];

  for (const t of tests) {
    const res = await fetch(t.url);
    const data = await res.json();
    const ids: number[] = data.appointmentIDs || [];
    results.push({ param: t.param, count: data.count, ids: ids.length, ignoredParams: data.ignoredParams });

    // If we got IDs, fetch details and check statuses
    if (ids.length > 0) {
      const detailUrl = `${BASE_URL}/appointment/get?appointmentIDs=${ids.join(',')}&${auth}`;
      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json();
      const propName = detailData.propertyName;
      const appts: any[] = propName && detailData[propName] ? Object.values(detailData[propName] as object) : [];
      const statusCounts: Record<string, number> = {};
      for (const a of appts) {
        const s = String(a.status);
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      }
      results.push({ param: `${t.param} status breakdown`, total: appts.length, statuses: statusCounts });
    }
  }
  return NextResponse.json(results);
}
