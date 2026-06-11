import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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
  const role = (session.user as any).role;
  if (!canAccess(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get('week');
  const officeParam = searchParams.get('office');

  const weekEnd = weekParam ? new Date(weekParam + "T00:00:00.000Z") : getWeekEnd(new Date());

  const where: any = { weekEnd };
  if (officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN') {
    where.office = officeParam;
  }

  const weeks = await prisma.techWeek.findMany({
    where,
    include: { technician: { select: { name: true, techId: true, status: true } } },
  });

  const active = weeks.filter((w: any) => w.totalScore !== null);

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
      activeTechs: active.length,
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
