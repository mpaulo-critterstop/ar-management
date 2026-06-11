import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any)?.role;
  if (!['ADMIN', 'LEADERSHIP'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, routeStartTime, scheduledHrs } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const record = await prisma.techDayAttendance.findUnique({ where: { id } });
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Recalculate minutesLate using new scheduled start time
  let minutesLate = record.minutesLate;
  const newRouteStartTime = routeStartTime ?? record.routeStartTime;

  if (record.startTime && newRouteStartTime) {
    const match = newRouteStartTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const scheduledMins = h * 60 + m;
      const startLocal = new Date(record.startTime.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const startMins = startLocal.getHours() * 60 + startLocal.getMinutes();
      minutesLate = startMins - scheduledMins;
    }
  }

  const newSchedHrs = scheduledHrs ?? record.scheduledHrs;

  const updated = await prisma.techDayAttendance.update({
    where: { id },
    data: {
      routeStartTime: newRouteStartTime,
      scheduledHrs: newSchedHrs,
      minutesLate,
      updatedAt: new Date(),
    },
    include: { technician: { select: { name: true } } },
  });

  // Recalculate weekly reliability score
  const weekRecords = await prisma.techDayAttendance.findMany({
    where: { techId: record.techId, weekEnd: record.weekEnd, status: 'WORKED' },
  });

  if (weekRecords.length > 0) {
    const avgLate = weekRecords.reduce((a, b) => a + (b.minutesLate ?? 0), 0) / weekRecords.length;
    const avgUtil = weekRecords.reduce((a, b) => a + ((b.hrsWorked ?? 0) / (b.scheduledHrs || 8)), 0) / weekRecords.length;
    const reliability = Math.min(((105 - avgLate * 2) * 0.5 + (avgUtil * 100) * 0.5), 110) / 100;

    await prisma.techWeek.updateMany({
      where: { techId: record.techId, weekEnd: record.weekEnd },
      data: { reliabilityScore: reliability, minutesLate: avgLate, utilization: avgUtil },
    });
  }

  return NextResponse.json(updated);
}
