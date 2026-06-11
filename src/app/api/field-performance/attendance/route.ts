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

  // Use noon UTC to avoid timezone day-shift issues (records stored as noon UTC)
  const weekEndNoon = new Date(weekParam + 'T12:00:00.000Z');
  const weekStartNoon = new Date(weekEndNoon);
  weekStartNoon.setDate(weekStartNoon.getDate() - 6);

  const where: any = {
    date: { gte: weekStartNoon, lte: weekEndNoon },
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
