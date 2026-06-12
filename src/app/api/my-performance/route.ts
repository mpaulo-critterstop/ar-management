import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any)?.role;
  if (role !== 'TECHNICIAN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const email = (session.user as any)?.email;

  // Find technician by linked email
  const technician = await prisma.technician.findFirst({
    where: { email },
  });

  if (!technician) return NextResponse.json({ error: 'No technician linked to this account. Contact your administrator.' }, { status: 404 });

  // Get all weeks for the current year
  const year = new Date().getFullYear();
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);

  const weeks = await prisma.techWeek.findMany({
    where: { techId: technician.techId, weekEnd: { gte: yearStart } },
    orderBy: { weekEnd: 'desc' },
  });

  // Monthly averages
  const monthlyMap = new Map<number, number[]>();
  for (const w of weeks) {
    if (w.totalScore === null) continue;
    const month = new Date(w.weekEnd).getUTCMonth() + 1;
    if (!monthlyMap.has(month)) monthlyMap.set(month, []);
    monthlyMap.get(month)!.push(w.totalScore);
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const monthly = Object.fromEntries([...monthlyMap.entries()].map(([m, s]) => [m, avg(s)]));
  const ytd = avg(weeks.filter(w => w.totalScore !== null).map(w => w.totalScore!));

  return NextResponse.json({
    technician: {
      techId: technician.techId,
      name: technician.name,
      team: technician.team,
      office: technician.office,
      crewLeader: technician.crewLeader,
    },
    latest: weeks[0] || null,
    weeks: weeks.slice(0, 52),
    monthly,
    ytd,
  });
}
