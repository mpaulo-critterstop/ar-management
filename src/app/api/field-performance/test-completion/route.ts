import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.FIELDROUTES_KEY_CSTAT!;
  const token = process.env.FIELDROUTES_TOKEN_CSTAT!;
  const results: any[] = [];

  // Step 1: Get spots for route 53911
  const spotSearchUrl = `${BASE_URL}/spot/search?officeIDs=4&routeIDs=53911&authenticationKey=${key}&authenticationToken=${token}`;
  const spotSearch = await fetch(spotSearchUrl);
  const spotData = await spotSearch.json();
  const spotIds: number[] = spotData.spotIDs || [];
  results.push({ step: '1. spot search', spotCount: spotIds.length });

  if (spotIds.length === 0) return NextResponse.json(results);

  // Step 2: Get spot details → collect all appointmentIDs
  const spotDetailUrl = `${BASE_URL}/spot/get?spotIDs=${spotIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const spotDetail = await fetch(spotDetailUrl);
  const spotDetailData = await spotDetail.json();
  const sPropName = spotDetailData.propertyName;
  const spots: any[] = sPropName && spotDetailData[sPropName] ? Object.values(spotDetailData[sPropName] as object) : [];
  const allApptIds: number[] = [];
  for (const spot of spots) {
    const ids: number[] = spot.appointmentIDs || [];
    allApptIds.push(...ids);
  }
  results.push({ step: '2. spot details', totalSpots: spots.length, totalAppointmentIDs: allApptIds.length });

  if (allApptIds.length === 0) return NextResponse.json(results);

  // Step 3: Fetch appointment details
  const apptUrl = `${BASE_URL}/appointment/get?appointmentIDs=${allApptIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const apptDetail = await fetch(apptUrl);
  const apptDetailData = await apptDetail.json();
  const aPropName = apptDetailData.propertyName;
  const appts: any[] = aPropName && apptDetailData[aPropName] ? Object.values(apptDetailData[aPropName] as object) : [];

  const statusBreakdown: Record<string, number> = {};
  for (const a of appts) {
    const key2 = `status=${a.status} (${a.statusText || '?'})`;
    statusBreakdown[key2] = (statusBreakdown[key2] || 0) + 1;
  }
  results.push({ step: '3. appointments', total: appts.length, statusBreakdown });

  // Step 4: Filter valid appointments (exclude no-show and deleted)
  const validAppts = appts.filter((a: any) =>
    String(a.status) !== '-1' &&
    String(a.status) !== '2' &&
    String(a.statusText || '').toLowerCase() !== 'no show'
  );
  const completedAppts = appts.filter((a: any) => String(a.status) === '1');
  results.push({
    step: '4. completion %',
    scheduled: allApptIds.length,
    validForProduction: validAppts.length,
    completed: completedAppts.length,
    completionPct: `${(completedAppts.length / allApptIds.length * 100).toFixed(1)}%`
  });

  // Step 5: Fetch subscriptions for valid appointments
  const subIds = [...new Set(validAppts.map((a: any) => String(a.subscriptionID)).filter(Boolean))];
  const subUrl = `${BASE_URL}/subscription/get?subscriptionIDs=${subIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const subDetail = await fetch(subUrl);
  const subDetailData = await subDetail.json();
  const subPropName = subDetailData.propertyName;
  const subs: any[] = subPropName && subDetailData[subPropName] ? Object.values(subDetailData[subPropName] as object) : [];

  // Step 6: Calculate production value
  const subChargeMap = new Map<string, number>();
  for (const s of subs) {
    const recurring = parseFloat(s.recurringCharge || '0');
    const initial = parseFloat(s.initialServiceTotal || '0');
    subChargeMap.set(String(s.subscriptionID), recurring > 0 ? recurring : initial);
  }

  let productionValue = 0;
  const apptBreakdown: any[] = [];
  for (const a of validAppts) {
    const charge = subChargeMap.get(String(a.subscriptionID)) || 0;
    productionValue += charge;
    apptBreakdown.push({ apptID: a.appointmentID, status: a.status, subID: a.subscriptionID, charge });
  }

  results.push({
    step: '5. production value',
    productionValue: productionValue.toFixed(2),
    subsFound: subs.length,
    apptBreakdown
  });

  return NextResponse.json(results);
}
