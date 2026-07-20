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
  const weekParam = searchParams.get('week');
  const monthStart = searchParams.get('monthStart');
  const monthEnd = searchParams.get('monthEnd');
  const officeParam = searchParams.get('office');
  const teamParam = searchParams.get('team');

  let dateFilter: any;
  if (monthStart && monthEnd) {
    dateFilter = { gte: new Date(monthStart), lte: new Date(monthEnd) };
  } else if (weekParam) {
    const weekEndNoon = new Date(weekParam + 'T12:00:00.000Z');
    const weekStartNoon = new Date(weekEndNoon);
    weekStartNoon.setDate(weekStartNoon.getDate() - 6);
    dateFilter = { gte: weekStartNoon, lte: weekEndNoon };
  } else {
    return NextResponse.json({ error: 'week or month required' }, { status: 400 });
  }

  const where: any = { date: dateFilter };
  if (officeParam && officeParam !== 'ALL') where.office = officeParam;
  if (teamParam) where.team = teamParam;

  const recordsRaw = await prisma.techDayAttendance.findMany({
    where,
    include: { technician: { select: { name: true, status: true, team: true, office: true, crewLeader: true, siteLeader: true } } },
    orderBy: [{ date: 'asc' }, { techId: 'asc' }],
  });
  const records = recordsRaw.map((r: any) => ({
    ...r,
    team: r.team ?? r.technician?.team ?? null,
    office: r.office ?? r.technician?.office ?? null,
    crewLeader: r.technician?.crewLeader ?? null,
    siteLeader: r.technician?.siteLeader ?? null,
  }));

  return NextResponse.json(records);
}
