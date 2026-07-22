import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any)?.role;
  if (!['Admin', 'Manager'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { techId, date, weekEnd, routeStartTime, scheduledHrs, startTime, finishTime } = body;
  if (!techId || !date || !weekEnd) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

  const tech = await prisma.technician.findUnique({ where: { techId } });
  if (!tech) return NextResponse.json({ error: 'Technician not found' }, { status: 404 });

  // Calculate minutesLate
  let minutesLate = null;
  if (startTime && routeStartTime) {
    const match = routeStartTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const scheduledMins = h * 60 + m;
      const startLocal = new Date(new Date(startTime).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const startMins = startLocal.getHours() * 60 + startLocal.getMinutes();
      minutesLate = startMins - scheduledMins;
    }
  }

  // Calculate hrsWorked
  let hrsWorked = null;
  if (startTime && finishTime) {
    hrsWorked = (new Date(finishTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);
  }

  const record = await prisma.techDayAttendance.create({
    data: {
      techId,
      technicianId: tech.id,
      date: new Date(date),
      weekEnd: new Date(weekEnd),
      office: tech.office,
      team: tech.team,
      routeStartTime: routeStartTime || '8:00 AM',
      scheduledHrs: scheduledHrs || 8,
      startTime: startTime ? new Date(startTime) : null,
      finishTime: finishTime ? new Date(finishTime) : null,
      minutesLate,
      hrsWorked,
      status: 'WORKED',
      manualOverride: true,
    },
    include: { technician: { select: { name: true } } },
  });

  return NextResponse.json(record, { status: 201 });
}



export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any)?.role;
  if (!['Admin', 'Manager'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, routeStartTime, scheduledHrs, startTime, finishTime } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const record = await prisma.techDayAttendance.findUnique({ where: { id } });
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const newRouteStartTime = routeStartTime ?? record.routeStartTime;
  const newSchedHrs = scheduledHrs ?? record.scheduledHrs;
  const isManualEdit = startTime !== undefined || finishTime !== undefined;

  // Use new times if provided, else keep existing
  const newStartTime = startTime ? new Date(startTime) : record.startTime;
  const newFinishTime = finishTime ? new Date(finishTime) : record.finishTime;

  // Recalculate minutesLate
  let minutesLate = record.minutesLate;
  if (newStartTime && newRouteStartTime) {
    const match = newRouteStartTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      const scheduledMins = h * 60 + m;
      const startLocal = new Date(newStartTime.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const startMins = startLocal.getHours() * 60 + startLocal.getMinutes();
      minutesLate = startMins - scheduledMins;
    }
  }

  // Recalculate hrsWorked
  let hrsWorked = record.hrsWorked;
  if (newStartTime && newFinishTime) {
    hrsWorked = (newFinishTime.getTime() - newStartTime.getTime()) / (1000 * 60 * 60);
  }

  const updateData: any = {
    routeStartTime: newRouteStartTime,
    scheduledHrs: newSchedHrs,
    minutesLate,
    hrsWorked,
    updatedAt: new Date(),
  };
  if (newStartTime) updateData.startTime = newStartTime;
  if (newFinishTime) updateData.finishTime = newFinishTime;
  if (isManualEdit) updateData.manualOverride = true;

  const updated = await prisma.techDayAttendance.update({
    where: { id },
    data: updateData,
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
