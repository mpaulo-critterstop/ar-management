import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

async function getRouteStats(routeID: string, key: string, token: string) {
  const spotSearch = await fetch(`${BASE_URL}/spot/search?officeIDs=4&routeIDs=${routeID}&authenticationKey=${key}&authenticationToken=${token}`).then(r => r.json());
  const spotIDs: number[] = spotSearch.spotIDs || [];
  if (spotIDs.length === 0) return null;
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

  return { routeID, stops: apptIDs.length, completed, pending, noShow, production: productionValue };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.FIELDROUTES_KEY_CSTAT!;
  const token = process.env.FIELDROUTES_TOKEN_CSTAT!;

  // Get all CStat routes for Jun 6-12
  const routeSearchUrl = `${BASE_URL}/route/search?officeIDs=4&dateStart=2026-06-06&dateEnd=2026-06-12&authenticationKey=${key}&authenticationToken=${token}`;
  const routeSearch = await fetch(routeSearchUrl);
  const routeData = await routeSearch.json();
  const allRouteIds: number[] = routeData.routeIDs || [];

  const routeDetailUrl = `${BASE_URL}/route/get?routeIDs=${allRouteIds.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
  const routeDetail = await fetch(routeDetailUrl);
  const routeDetailData = await routeDetail.json();
  const propName = routeDetailData.propertyName;
  const routes: any[] = propName && routeDetailData[propName] ? Object.values(routeDetailData[propName] as object) : [];

  // PMP tech IDs for CStat
  const pmpTechIds: Record<string, string> = {
    '10579': 'P-001 Jacob Kidd',
    '10583': 'P-004 Justin Rogers',
    '10574': 'P-010 Clifton Kuhn',
    '10838': 'P-023 Devin Canter',
    '10856': 'P-024 Cynthia Barrientos',
  };

  const techStats: Record<string, { stops: number; completed: number; pending: number; noShow: number; production: number }> = {};
  for (const id of Object.keys(pmpTechIds)) {
    techStats[id] = { stops: 0, completed: 0, pending: 0, noShow: 0, production: 0 };
  }

  const pmpRoutes = routes.filter((r: any) => pmpTechIds[String(r.assignedTech)]);

  // Debug: show route counts per tech
  const routeCountByTech: Record<string, number> = {};
  for (const r of pmpRoutes) {
    const empId = String(r.assignedTech);
    routeCountByTech[empId] = (routeCountByTech[empId] || 0) + 1;
  }
  const debugInfo = Object.entries(routeCountByTech).map(([id, count]) => `${pmpTechIds[id]}:${count}routes`).join(', ');

  for (const route of pmpRoutes) {
    const stats = await getRouteStats(String(route.routeID), key, token);
    if (!stats) continue;
    const empId = String(route.assignedTech);
    techStats[empId].stops += stats.stops;
    techStats[empId].completed += stats.completed;
    techStats[empId].pending += stats.pending;
    techStats[empId].noShow += stats.noShow;
    techStats[empId].production += stats.production;
  }

  const results = Object.entries(techStats).map(([empId, s]) => {
    const denom = s.completed + s.pending + s.noShow;
    return {
      tech: pmpTechIds[empId],
      stops: s.stops,
      completed: s.completed,
      pending: s.pending,
      noShow: s.noShow,
      completionPct: denom > 0 ? ((s.completed / denom) * 100).toFixed(1) + '%' : '—',
      production: '$' + s.production.toFixed(2),
    };
  });

  return NextResponse.json({ debug: { totalRoutes: routes.length, pmpRoutes: pmpRoutes.length, routesByTech: debugInfo }, results });
}
