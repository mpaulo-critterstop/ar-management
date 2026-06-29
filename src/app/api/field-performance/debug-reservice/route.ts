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

  const CSTAT_KEY   = process.env.FIELDROUTES_KEY_CSTAT  || 'v26mmb5lm48qnvciq271v189bseepdj3iechgt4tjjta75ee09lrjo4laou0d15l';
  const CSTAT_TOKEN = process.env.FIELDROUTES_TOKEN_CSTAT || 'q7b1tv49r3emq3mibkg43j71vt0qd60fgrjesjmqa3nnqe3brog3uadlvo03j3mj';
  const CSTAT_AUTH  = `authenticationKey=${CSTAT_KEY}&authenticationToken=${CSTAT_TOKEN}`;

  // Fetch a sample CStat appointment to check field names
  const cstatWeek = await fetch(`${BASE_URL}/appointment/search?officeIDs=4&dateStart=2026-06-13&dateEnd=2026-06-19&${CSTAT_AUTH}`).then(r=>r.json());
  const cstatIds: number[] = (cstatWeek.appointmentIDs || []).slice(0, 3);
  let cstatSample: any = null;
  if (cstatIds.length > 0) {
    const cstatAppt = await fetch(`${BASE_URL}/appointment/get?appointmentIDs=${cstatIds.join(',')}&${CSTAT_AUTH}`).then(r=>r.json());
    const prop = cstatAppt.propertyName;
    const appts = prop && cstatAppt[prop] ? Object.values(cstatAppt[prop] as object) : [];
    cstatSample = appts[0] || null;
  }

  results.push({ test: 'CStat week sample appointment', ids: cstatIds, sample_keys: cstatSample ? Object.keys(cstatSample) : [], type: cstatSample?.type, serviceTypeID: cstatSample?.serviceTypeID, serviceType: cstatSample?.serviceType });

  return NextResponse.json(results);
}
}
