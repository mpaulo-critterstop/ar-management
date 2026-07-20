import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function canAccess(role: string) {
  return ['ADMIN', 'MANAGER', 'LEADERSHIP'].includes(role);
}

function avg(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
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
  const monthStart = searchParams.get('monthStart');
  const monthEnd = searchParams.get('monthEnd');
  const officeParam = searchParams.get('office');

  const weekEnd = weekParam ? new Date(weekParam + "T00:00:00.000Z") : getWeekEnd(new Date());

  let where: any;
  if (monthStart && monthEnd) {
    where = { weekEnd: { gte: new Date(monthStart), lte: new Date(monthEnd) } };
  } else {
    const dayStart = new Date(weekParam ? weekParam + "T00:00:00.000Z" : getWeekEnd(new Date()).toISOString().split("T")[0] + "T00:00:00.000Z");
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    where = { weekEnd: { gte: dayStart, lt: dayEnd } };
  }
  if (officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN') {
    where.office = officeParam;
  }

  const weeks = await prisma.techWeek.findMany({
    where,
    include: { technician: { select: { name: true } } },
  });

  const active = weeks.filter((w: any) => w.totalScore !== null);

  // Crew leader rollup
  const crewMap = new Map<string, { leader: string; office: string; weeks: typeof active }>();
  for (const w of active) {
    if (!w.crewLeader) continue;
    const key = w.crewLeader;
    if (!crewMap.has(key)) crewMap.set(key, { leader: w.crewLeader, office: w.office, weeks: [] });
    crewMap.get(key)!.weeks.push(w);
  }

  const crewLeaders = [...crewMap.values()].map(c => ({
    leader: c.leader,
    office: c.office,
    techCount: c.weeks.length,
    avgScore: avg(c.weeks.map((w: any) => w.totalScore!)),
    avgCloseOutPct: avg(c.weeks.filter((w: any) => w.closeOutPct !== null).map((w: any) => w.closeOutPct!)),
    avgCallbackRate: avg(c.weeks.filter((w: any) => w.callbackRate !== null).map((w: any) => w.callbackRate!)),
    avgDriving: avg(c.weeks.filter((w: any) => w.drivingScore !== null).map((w: any) => w.drivingScore!)),
  })).sort((a: any, b: any) => (b.avgScore ?? 0) - (a.avgScore ?? 0));

  // Site leader rollup
  const siteMap = new Map<string, { leader: string; office: string; crews: Set<string>; weeks: typeof active }>();
  for (const w of active) {
    if (!w.siteLeader) continue;
    const key = w.siteLeader;
    if (!siteMap.has(key)) siteMap.set(key, { leader: w.siteLeader, office: w.office, crews: new Set(), weeks: [] });
    const entry = siteMap.get(key)!;
    entry.weeks.push(w);
    if (w.crewLeader) entry.crews.add(w.crewLeader);
  }

  const siteLeaders = [...siteMap.values()].map((s: any) => {
    const wpWeeks = s.weeks.filter((w: any) => w.team === 'WP');
    const pmpWeeks = s.weeks.filter((w: any) => w.team === 'PMP');
    return {
      leader: s.leader,
      office: s.office,
      crewCount: s.crews.size,
      techCount: s.weeks.length,
      avgScore: avg(s.weeks.map((w: any) => w.totalScore!)),
      wpAvg: avg(wpWeeks.map((w: any) => w.totalScore!)),
      pmpAvg: avg(pmpWeeks.map((w: any) => w.totalScore!)),
    };
  }).sort((a: any, b: any) => (b.avgScore ?? 0) - (a.avgScore ?? 0));

  return NextResponse.json({ weekEnd, crewLeaders, siteLeaders });
}
