// Lunch on Critter Stop — team recognition winners.
// Weekly: team with highest avg TEM (totalScore) for the week.
// Monthly: safest-driving team (avg drivingScore) + highest-reliability team (avg reliabilityScore).
// Teams are grouped by crewLeader. GET /api/field-performance/lunch-winners?year=2026
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const year = parseInt(req.nextUrl.searchParams.get('year') || '2026');
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const weeks = await prisma.techWeek.findMany({
    where: { weekEnd: { gte: yearStart, lt: yearEnd } },
    select: { weekEnd: true, crewLeader: true, totalScore: true, drivingScore: true, reliabilityScore: true },
  });

  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

  // Group by (weekEnd, crewLeader) for weekly; by (month, crewLeader) for monthly.
  type Agg = Record<string, Record<string, number[]>>; // key -> leader -> values
  const weeklyTem: Agg = {};
  const monthlyDrive: Agg = {};
  const monthlyRel: Agg = {};

  for (const w of weeks) {
    const leader = w.crewLeader;
    if (!leader) continue;
    const wk = new Date(w.weekEnd).toISOString().slice(0, 10);
    const mo = new Date(w.weekEnd).toISOString().slice(0, 7);
    if (w.totalScore != null) ((weeklyTem[wk] ||= {})[leader] ||= []).push(w.totalScore);
    if (w.drivingScore != null) ((monthlyDrive[mo] ||= {})[leader] ||= []).push(w.drivingScore);
    if (w.reliabilityScore != null) ((monthlyRel[mo] ||= {})[leader] ||= []).push(w.reliabilityScore);
  }

  // Winner = leader with the highest team average for each period.
  function winners(agg: Agg, periodLabel: (k: string) => string) {
    return Object.entries(agg).map(([period, byLeader]) => {
      let best: { leader: string; score: number } | null = null;
      for (const [leader, vals] of Object.entries(byLeader)) {
        const a = avg(vals);
        if (a != null && (!best || a > best.score)) best = { leader, score: a };
      }
      return best ? { period, label: periodLabel(period), team: best.leader, score: Math.round(best.score * 1000) / 1000 } : null;
    }).filter(Boolean).sort((a: any, b: any) => b.period.localeCompare(a.period));
  }

  const weekLabel = (k: string) => `Week of ${k}`;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monLabel = (k: string) => `${monthNames[parseInt(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;

  return NextResponse.json({
    year,
    weeklyTem: winners(weeklyTem, weekLabel),
    monthlyDriving: winners(monthlyDrive, monLabel),
    monthlyReliability: winners(monthlyRel, monLabel),
  });
}
