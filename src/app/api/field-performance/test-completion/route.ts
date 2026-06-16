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

  // Fetch spots for Devin's route 55193 - show full appointmentIDs per spot
  const spotSearchUrl = `${BASE_URL}/spot/search?officeIDs=4&routeIDs=55194&authenticationKey=${key}&authenticationToken=${token}`;
  const spotSearch = await fetch(spotSearchUrl);
  const spotSearchData = await spotSearch.json();
  const spotIds: number[] = spotSearchData.spotIDs || [];

  results.push({ step: 'spot search', count: spotIds.length });

  if (spotIds.length > 0) {
    const spotDetailUrl = `${BASE_URL}/spot/get?spotIDs=${spotIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
    const spotDetail = await fetch(spotDetailUrl);
    const spotDetailData = await spotDetail.json();
    const sPropName = spotDetailData.propertyName;
    const spots: any[] = sPropName && spotDetailData[sPropName] ? Object.values(spotDetailData[sPropName] as object) : [];

    let totalApptIds = 0;
    for (const spot of spots) {
      const apptIds: number[] = spot.appointmentIDs || [];
      if (apptIds.length > 0) {
        totalApptIds += apptIds.length;
        results.push({
          spotID: spot.spotID,
          appointmentCount: apptIds.length,
          appointmentIDs: apptIds,
          currentAppointment: spot.currentAppointment,
        });
      }
    }
    results.push({ step: 'summary', spotsWithAppts: results.length - 1, totalAppointmentIDs: totalApptIds });
  }

  return NextResponse.json(results);
}
