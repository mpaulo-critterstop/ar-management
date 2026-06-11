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
  const { id, startTime, finishTime, scheduledHrs } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Recalculate minutesLate and hrsWorked
  const record = await prisma.techDayAttendance.findUnique({ where: { id } });
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const newStart = startTime ? new Date(startTime) : record.startTime;
  const newFinish = finishTime ? new Date(finishTime) : record.finishTime;
  const newSchedHrs = scheduledHrs ?? record.scheduledHrs;

  // Parse scheduled start from routeStartTime e.g. "7:00 AM"
  let minutesLate = record.minutesLate;
  let hrsWorked = record.hrsWorked;

  if (newStart && record.routeStartTime) {
    const match = record.routeStartTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const scheduledMins = h * 60 + m;
      const startLocal = new Date(newStart.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const startMins = startLocal.getHours() * 60 + startLocal.getMinutes();
      minutesLate = startMins - scheduledMins;
    }
  }

  if (newStart && newFinish) {
    hrsWorked = (newFinish.getTime() - newStart.getTime()) / (1000 * 60 * 60);
  }

  const updated = await prisma.techDayAttendance.update({
    where: { id },
    data: {
      startTime: newStart,
      finishTime: newFinish,
      scheduledHrs: newSchedHrs,
      minutesLate,
      hrsWorked,
      updatedAt: new Date(),
    },
    include: { technician: { select: { name: true } } },
  });

  // Recalculate weekly reliability score for this tech
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
