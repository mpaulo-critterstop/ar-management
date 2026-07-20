import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any)?.role;
  if (!['ADMIN', 'MANAGER', 'LEADERSHIP'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get('year') || '2026');
  const officeParam = searchParams.get('office');

  // Get all tech weeks for the year
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  const where: any = {
    weekEnd: { gte: yearStart, lt: yearEnd },
    totalScore: { not: null },
  };
  if (officeParam && officeParam !== 'ALL') where.office = officeParam;

  const weeks = await prisma.techWeek.findMany({
    where,
    include: { technician: { select: { name: true, status: true, crewLeader: true, siteLeader: true } } },
    orderBy: { weekEnd: 'asc' },
  });

  // Group by tech and month
  const months = [1,2,3,4,5,6,7,8,9,10,11,12];
  const techMap = new Map<string, {
    techId: string;
    name: string;
    office: string;
    team: string;
    crewLeader: string | null;
    siteLeader: string | null;
    status: string;
    monthly: Record<number, number[]>;
    ytd: number[];
  }>();

  for (const w of weeks) {
    const month = new Date(w.weekEnd).getUTCMonth() + 1;
    if (!techMap.has(w.techId)) {
      techMap.set(w.techId, {
        techId: w.techId,
        name: w.technician.name,
        office: w.office,
        team: w.team,
        crewLeader: (w.technician as any).crewLeader ?? null,
        siteLeader: (w.technician as any).siteLeader ?? null,
        status: (w.technician as any).status ?? 'ACTIVE',
        monthly: {},
        ytd: [],
      });
    }
    const entry = techMap.get(w.techId)!;
    if (!entry.monthly[month]) entry.monthly[month] = [];
    entry.monthly[month].push(w.totalScore!);
    entry.ytd.push(w.totalScore!);
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const result = [...techMap.values()].map(t => ({
    techId: t.techId,
    name: t.name,
    office: t.office,
    team: t.team,
    crewLeader: t.crewLeader,
    siteLeader: t.siteLeader,
    status: t.status,
    ytd: avg(t.ytd),
    monthly: Object.fromEntries(months.map(m => [m, avg(t.monthly[m] || [])])),
  })).sort((a, b) => (b.ytd ?? 0) - (a.ytd ?? 0));

  return NextResponse.json({ year, techs: result });
}
