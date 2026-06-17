import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

async function getRouteStats(routeID: string, key: string, token: string) {
  const spotSearch = await fetch(`${BASE_URL}/spot/search?officeIDs=4&routeIDs=${routeID}&authenticationKey=${key}&authenticationToken=${token}`).then(r => r.json());
  const spotIDs: number[] = spotSearch.spotIDs || [];
  const spotData = await fetch(`${BASE_URL}/spot/get?spotIDs=${spotIDs.join(',')}&authenticationKey=${key}&authenticationToken=${token}`).then(r => r.json());
  const sPropName = spotData.propertyName;
  const spots: any[] = sPropName && spotData[sPropName] ? Object.values(spotData[sPropName] as object) : [];
  const apptIDs: number[] = [];
  spots.forEach((s: any) => { if (s.appointmentIDs?.length) apptIDs.push(...s.appointmentIDs); });
  if (apptIDs.length === 0) return null;

  const apptData = await fetch(`${BASE_URL}/appointment/get?appointmentIDs=${apptIDs.join(',')}&authenticationKey=${key}&authenticationToken=${token}`).then(r => r.json());
  const aPropName = apptData.propertyName;
  const appointments: any[] = aPropName && apptData[aPropName] ? Object.values(apptData[aPropName] as object) : [];

  const completed = appointments.filter((a: any) => String(a.status) === '1').length;
  const pending = appointments.filter((a: any) => String(a.status) === '0').length;
  const noShow = appointments.filter((a: any) => String(a.statusText || '') === 'No Show').length;
  const completionRate = completed + pending + noShow > 0 ? ((completed / (completed + pending + noShow)) * 100).toFixed(1) : '0.0';

  const validAppts = appointments.filter((a: any) => String(a.status) !== '-1');
  const noShowWithTicket = validAppts.filter((a: any) => String(a.statusText || '') === 'No Show' && a.ticketID && String(a.ticketID) !== '0');
  const nonNoShow = validAppts.filter((a: any) => String(a.statusText || '') !== 'No Show');

  const subIDs = [...new Set(nonNoShow.map((a: any) => String(a.subscriptionID)).filter((s: string) => parseInt(s) > 0))];
  const subMap = new Map<string, number>();
  if (subIDs.length > 0) {
    const subData = await fetch(`${BASE_URL}/subscription/get?subscriptionIDs=${subIDs.join(',')}&authenticationKey=${key}&authenticationToken=${token}`).then(r => r.json());
    const subPropName = subData.propertyName;
    const subs: any[] = subPropName && subData[subPropName] ? Object.values(subData[subPropName] as object) : [];
    subs.forEach((s: any) => {
      const recurring = parseFloat(s.recurringCharge || '0');
      const initial = parseFloat(s.initialServiceTotal || '0');
      subMap.set(String(s.subscriptionID), recurring > 0 ? recurring : initial);
    });
  }

  const needsTicket = nonNoShow.filter((a: any) => {
    const hasSub = parseInt(a.subscriptionID || '0') > 0;
    if (!hasSub) return a.ticketID && String(a.ticketID) !== '0';
    return !subMap.has(String(a.subscriptionID)) && a.ticketID && String(a.ticketID) !== '0';
  });
  const allTicketNeeded = [...needsTicket, ...noShowWithTicket];
  const ticketMap = new Map<string, number>();
  if (allTicketNeeded.length > 0) {
    const ticketIDs = [...new Set(allTicketNeeded.map((a: any) => String(a.ticketID)))];
    const ticketData = await fetch(`${BASE_URL}/ticket/get?ticketIDs=${ticketIDs.join(',')}&authenticationKey=${key}&authenticationToken=${token}`).then(r => r.json());
    const tPropName = ticketData.propertyName;
    const tickets: any[] = tPropName && ticketData[tPropName] ? Object.values(ticketData[tPropName] as object) : [];
    tickets.forEach((t: any) => ticketMap.set(String(t.ticketID), parseFloat(t.subTotal || '0')));
  }

  let productionValue = 0;
  for (const a of nonNoShow) {
    const hasSub = parseInt(a.subscriptionID || '0') > 0;
    if (hasSub && subMap.has(String(a.subscriptionID))) {
      productionValue += subMap.get(String(a.subscriptionID))!;
    } else if (a.ticketID && String(a.ticketID) !== '0') {
      productionValue += ticketMap.get(String(a.ticketID)) || 0;
    }
  }
  for (const a of noShowWithTicket) {
    productionValue += ticketMap.get(String(a.ticketID)) || 0;
  }

  return { routeID, stops: apptIDs.length, completed, pending, noShow, completionRate: completionRate + '%', production: productionValue.toFixed(2) };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.FIELDROUTES_KEY_CSTAT!;
  const token = process.env.FIELDROUTES_TOKEN_CSTAT!;

  // Justin Rogers routes for Jun 6-12
  const justinRoutes = ['49209', '52571', '52852', '53908', '53911'];
  const results: any[] = [];
  let totalStops = 0, totalCompleted = 0, totalPending = 0, totalNoShow = 0, totalProduction = 0;

  for (const routeID of justinRoutes) {
    const stats = await getRouteStats(routeID, key, token);
    if (!stats) continue;
    results.push(stats);
    totalStops += stats.stops;
    totalCompleted += stats.completed;
    totalPending += stats.pending;
    totalNoShow += stats.noShow;
    totalProduction += parseFloat(stats.production);
  }

  const completionPct = totalCompleted + totalPending + totalNoShow > 0
    ? ((totalCompleted / (totalCompleted + totalPending + totalNoShow)) * 100).toFixed(1)
    : '0.0';

  results.push({ summary: 'Justin Rogers week total', totalStops, totalCompleted, totalPending, totalNoShow, completionPct: completionPct + '%', totalProduction: totalProduction.toFixed(2) });

  return NextResponse.json(results);
}
