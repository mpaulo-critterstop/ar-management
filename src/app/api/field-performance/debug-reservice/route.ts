import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const KEY   = '6t0i20austp8ts2ln5296vi45qifgjrh08bbpfp1svijke8enjpr8d55qo81nsml';
const TOKEN = 'uinj35806p728f9bktr984gsml74a8to077g6ufpjcvlk7v5g0bgqe256l2nn5gb';
const AUTH  = `authenticationKey=${KEY}&authenticationToken=${TOKEN}`;

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: any[] = [];

  const tests = [
    { test: 'office-wide no date',            url: `${BASE_URL}/appointment/search?officeIDs=1&${AUTH}` },
    { test: 'office-wide dateStart/dateEnd',   url: `${BASE_URL}/appointment/search?officeIDs=1&dateStart=2026-03-21&dateEnd=2026-06-19&${AUTH}` },
    { test: 'employeeIDs plural + dateStart',  url: `${BASE_URL}/appointment/search?officeIDs=1&employeeIDs=10440&dateStart=2026-03-21&dateEnd=2026-06-19&${AUTH}` },
    { test: 'employeeID singular + dateStart', url: `${BASE_URL}/appointment/search?officeIDs=1&employeeID=10440&dateStart=2026-03-21&dateEnd=2026-06-19&${AUTH}` },
    { test: 'employeeIDs no date',             url: `${BASE_URL}/appointment/search?officeIDs=1&employeeIDs=10440&${AUTH}` },
    { test: 'week dateStart/dateEnd',          url: `${BASE_URL}/appointment/search?officeIDs=1&dateStart=2026-06-13&dateEnd=2026-06-19&${AUTH}` },
  ];

  for (const { test, url } of tests) {
    try {
      const data = await fetch(url).then(r => r.json());
      results.push({ test, count: (data.appointmentIDs||[]).length, success: data.success, error: data.errorMessage });
    } catch (e: any) {
      results.push({ test, error: e.message });
    }
  }

  return NextResponse.json(results);
}
