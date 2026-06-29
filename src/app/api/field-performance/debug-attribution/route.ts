import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const KEY   = process.env.FIELDROUTES_KEY_CSTAT  || 'v26mmb5lm48qnvciq271v189bseepdj3iechgt4tjjta75ee09lrjo4laou0d15l';
const TOKEN = process.env.FIELDROUTES_TOKEN_CSTAT || 'q7b1tv49r3emq3mibkg43j71vt0qd60fgrjesjmqa3nnqe3brog3uadlvo03j3mj';
const AUTH  = `authenticationKey=${KEY}&authenticationToken=${TOKEN}`;
const RESERVICE_TYPES = new Set(['822','821','807','732']);

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: any[] = [];

  for (const custId of ['18653', '45027']) {
    const search = await fetch(`${BASE_URL}/appointment/search?officeIDs=4&customerID=${custId}&dateStart=2026-03-21&dateEnd=2026-06-19&${AUTH}`).then(r=>r.json());
    const ids: number[] = search.appointmentIDs || [];

    if (ids.length === 0) {
      results.push({ customer: custId, error: 'no appointments found' });
      continue;
    }

    const apptData = await fetch(`${BASE_URL}/appointment/get?appointmentIDs=${ids.join(',')}&${AUTH}`).then(r=>r.json());
    const prop = apptData.propertyName;
    const appts: any[] = prop && apptData[prop] ? Object.values(apptData[prop] as object) : [];

    const regular = appts
      .filter((a: any) => !RESERVICE_TYPES.has(String(a.type || a.serviceTypeID || '')) && String(a.status) === '1')
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const reservices = appts
      .filter((a: any) => RESERVICE_TYPES.has(String(a.type || a.serviceTypeID || '')) && String(a.status) === '1');

    results.push({
      customer: custId,
      total_appts: appts.length,
      reservices: reservices.map((a: any) => ({ date: a.date, type: a.type, serviceTypeID: a.serviceTypeID, servicedBy: a.servicedBy, employeeID: a.employeeID })),
      last_regular: regular[0] ? { date: regular[0].date, type: regular[0].type, serviceTypeID: regular[0].serviceTypeID, servicedBy: regular[0].servicedBy, employeeID: regular[0].employeeID } : null,
    });
  }

  return NextResponse.json(results);
}
