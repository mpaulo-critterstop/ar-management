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
  const officeParam = searchParams.get('office');
  const teamParam = searchParams.get('team');

  if (!weekParam) return NextResponse.json({ error: 'week required' }, { status: 400 });

  const dayStart = new Date(weekParam + 'T00:00:00.000Z');
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekStart = new Date(dayStart);
  weekStart.setDate(weekStart.getDate() - 6);

  const where: any = {
    date: { gte: weekStart, lt: dayEnd },
  };
  if (officeParam && officeParam !== 'ALL') where.office = officeParam;
  if (teamParam) where.team = teamParam;

  const records = await prisma.techDayAttendance.findMany({
    where,
    include: { technician: { select: { name: true, status: true } } },
    orderBy: [{ date: 'asc' }, { techId: 'asc' }],
  });

  return NextResponse.json(records);
}
