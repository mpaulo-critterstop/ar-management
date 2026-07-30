import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

function canAccess(role: string) {
  return ['Admin', 'Manager'].includes(role);
}

function getWeekEnd(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 6 ? 0 : 6 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any).role;
  if (!canAccess(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get('week');
  const monthStart = searchParams.get('monthStart');
  const monthEnd = searchParams.get('monthEnd');
  const officeParam = searchParams.get('office');
  const leaderParam = searchParams.get('leader') || '';
  const isMonth = !!(monthStart && monthEnd);

  const weekEnd = weekParam ? new Date(weekParam + "T00:00:00.000Z") : getWeekEnd(new Date());

  let where: any;
  if (isMonth) {
    where = { weekEnd: { gte: new Date(monthStart!), lte: new Date(monthEnd!) } };
  } else {
    const dayStart = new Date(weekParam ? weekParam + "T00:00:00.000Z" : getWeekEnd(new Date()).toISOString().split("T")[0] + "T00:00:00.000Z");
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    where = { weekEnd: { gte: dayStart, lt: dayEnd } };
  }
  if (officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN') {
    where.office = officeParam;
  }

  const weeks = await prisma.techWeek.findMany({
    where: { ...where, technician: { status: 'ACTIVE', ...(leaderParam ? { crewLeader: leaderParam } : {}) } },
    include: { technician: { select: { name: true, techId: true, status: true } } },
  });

  const totalActiveTechs = await prisma.technician.count({ where: { status: 'ACTIVE' } });

  let active = weeks.filter((w: any) => w.totalScore !== null && w.technician?.status === 'ACTIVE');

  // MONTH MODE: collapse each tech's multiple weeks into one averaged row so summary stats and
  // topPerformers count each tech once (not once per week).
  if (isMonth) {
    const byTech = new Map<string, any[]>();
    for (const w of active) {
      if (!byTech.has(w.techId)) byTech.set(w.techId, []);
      byTech.get(w.techId)!.push(w);
    }
    const mean = (rows: any[], f: string) => {
      const vals = rows.map(r => r[f]).filter((v: any) => v !== null && v !== undefined);
      return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;
    };
    active = [...byTech.values()].map(rows => ({
      ...rows[0],
      totalScore: mean(rows, 'totalScore'),
      closeOutPct: mean(rows, 'closeOutPct'),
      callbackRate: mean(rows, 'callbackRate'),
      drivingScore: mean(rows, 'drivingScore'),
      reliabilityScore: mean(rows, 'reliabilityScore'),
    }));
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const scores = active.map((w: any) => w.totalScore!);
  const coValues = active.filter((w: any) => w.closeOutPct !== null).map((w: any) => w.closeOutPct!);
  const cbValues = active.filter((w: any) => w.callbackRate !== null).map((w: any) => w.callbackRate!);
  const relValues = active.filter((w: any) => w.reliabilityScore !== null).map((w: any) => w.reliabilityScore!);

  const offices = ['DFW', 'ATX', 'OKC', 'CStat'];
  const officeBreakdown = offices.map(o => {
    const oWeeks = active.filter((w: any) => w.office === o);
    return {
      office: o,
      avgScore: avg(oWeeks.map((w: any) => w.totalScore!)),
      techCount: oWeeks.length,
    };
  });

  const teams = ['WP', 'PMP', 'IP'];
  const teamBreakdown = teams.map(t => {
    const tWeeks = active.filter((w: any) => w.team === t);
    return {
      team: t,
      avgScore: avg(tWeeks.map((w: any) => w.totalScore!)),
      techCount: tWeeks.length,
    };
  });

  // Top performers sorted by score
  const topPerformers = [...active]
    .sort((a: any, b: any) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
    .slice(0, 10)
    .map((w: any) => ({
      techId: w.techId,
      name: w.technician.name,
      team: w.team,
      office: w.office,
      score: w.totalScore,
      closeOutPct: w.closeOutPct,
      callbackRate: w.callbackRate,
      drivingScore: w.drivingScore,
      reliabilityScore: w.reliabilityScore,
    }));

  // ---- Excel Scoreboard tiles ----
  // Effort-meter averages by segment/office/combo (avg of totalScore over the matching techweeks).
  const avgWhere = (fn: (w: any) => boolean) => avg(active.filter(fn).map((w: any) => w.totalScore!));
  const effortMeters = {
    WP:  avgWhere((w: any) => w.team === 'WP'),
    IP:  avgWhere((w: any) => w.team === 'IP'),
    PMP: avgWhere((w: any) => w.team === 'PMP'),
    DFW:   avgWhere((w: any) => w.office === 'DFW'),
    ATX:   avgWhere((w: any) => w.office === 'ATX'),
    OKC:   avgWhere((w: any) => w.office === 'OKC'),
    CStat: avgWhere((w: any) => w.office === 'CStat'),
    DFW_WP_IP: avgWhere((w: any) => w.office === 'DFW' && (w.team === 'WP' || w.team === 'IP')),
    DFW_PMP:   avgWhere((w: any) => w.office === 'DFW' && w.team === 'PMP'),
  };

  // DFW Pest Route Value — avg productionValue from tech_routes for DFW in the same period.
  const routeWhere: any = { office: 'DFW' };
  if (isMonth) routeWhere.weekEnd = { gte: new Date(monthStart!), lte: new Date(monthEnd!) };
  else routeWhere.weekEnd = where.weekEnd;
  const dfwRoutes = await prisma.techRoute.aggregate({
    where: routeWhere,
    _avg: { productionValue: true },
  });
  const dfwPestRouteValue = dfwRoutes._avg.productionValue ?? null;

  // TC Frequency (avg nextVisitDays) for the SELECTED period (week or month), honoring office.
  // Excel Scoreboard row 4 is AVERAGEIFS by weekEnd, so it changes with the selected week.
  const tcFreqOffice = officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN' ? officeParam : null;
  const tcWhere: any = { nextVisitDays: { not: null } };
  if (tcFreqOffice) tcWhere.office = tcFreqOffice;
  if (isMonth) tcWhere.date = { gte: new Date(monthStart!), lte: new Date(monthEnd!) };
  else {
    // week mode: the tc_appointments in the same week as the selected weekEnd (weekEnd matches).
    tcWhere.weekEnd = where.weekEnd;
  }
  const tcAgg = await prisma.tcAppointment.aggregate({ where: tcWhere, _avg: { nextVisitDays: true }, _count: { nextVisitDays: true } });
  let tcFrequency = tcAgg._avg.nextVisitDays != null ? Math.round(tcAgg._avg.nextVisitDays * 100) / 100 : null;
  // Fallback: if the selected period has no TC data (common for older/empty weeks), show the latest
  // complete-month company figure so the tile isn't blank.
  let tcFrequencyIsFallback = false;
  if (tcFrequency == null) {
    const fb: Array<{ value: number | null }> = tcFreqOffice
      ? await prisma.$queryRaw`SELECT AVG("nextVisitDays") AS value FROM "tc_appointments" WHERE "nextVisitDays" IS NOT NULL AND office = ${tcFreqOffice} AND "date" >= (date_trunc('month', CURRENT_DATE) - interval '2 months') AND "date" < date_trunc('month', CURRENT_DATE)`
      : await prisma.$queryRaw`SELECT AVG("nextVisitDays") AS value FROM "tc_appointments" WHERE "nextVisitDays" IS NOT NULL AND "date" >= (date_trunc('month', CURRENT_DATE) - interval '2 months') AND "date" < date_trunc('month', CURRENT_DATE)`;
    tcFrequency = fb[0]?.value != null ? Math.round(Number(fb[0].value) * 100) / 100 : null;
    tcFrequencyIsFallback = tcFrequency != null;
  }

  // Capacity (W/I/PMP) — count of techs per segment with utilization > 0 for the period.
  // Excel: COUNTIFS(Raw Data AB[Utilization] > 0, F[segment], A[weekEnd]).
  const capCount = (team: string) =>
    active.filter((w: any) => w.team === team && (w.utilization ?? 0) > 0).length;
  const capacity = { W: capCount('WP'), I: capCount('IP'), PMP: capCount('PMP') };

  return NextResponse.json({
    weekEnd,
    summary: {
      avgScore: avg(scores),
      activeTechs: totalActiveTechs,
      avgCloseOutPct: avg(coValues),
      avgCallbackRate: avg(cbValues),
      avgReliability: avg(relValues),
      aboveTarget: scores.filter((s: number) => s >= 0.90).length,
    },
    officeBreakdown,
    teamBreakdown,
    topPerformers,
    // Excel Scoreboard tiles:
    effortMeters,
    dfwPestRouteValue,
    tcFrequency,
    tcFrequencyIsFallback,
    capacity,
    standards: { effortMeter: 0.90, tcFrequency: 10 },
  });
}
