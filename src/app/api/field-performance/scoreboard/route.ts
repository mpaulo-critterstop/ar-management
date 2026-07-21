import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

function canAccess(role: string) {
  return ['ADMIN', 'MANAGER', 'LEADERSHIP'].includes(role);
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
  });
}
