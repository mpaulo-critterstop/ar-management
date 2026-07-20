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
  const techIdParam = searchParams.get('techId');
  const allWeeks = searchParams.get('allWeeks') === 'true';

  const where: any = {};
  // allWeeks=true (or no week) returns every adjustment across all weeks.
  if (weekParam && !allWeeks) {
    const dayStart = new Date(weekParam + 'T00:00:00.000Z');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    where.weekEnd = { gte: dayStart, lt: dayEnd };
  }
  const techFilter: any = {};
  if (officeParam && officeParam !== 'ALL') techFilter.office = officeParam;
  if (techIdParam) where.techId = techIdParam;
  if (Object.keys(techFilter).length) where.technician = techFilter;

  const adjs = await prisma.manualAdj.findMany({
    where,
    include: { technician: { select: { name: true, office: true, team: true, crewLeader: true, siteLeader: true } } },
    orderBy: { weekEnd: 'desc' },
  });

  return NextResponse.json(adjs);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any)?.role;
  if (!['ADMIN', 'LEADERSHIP'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { techId, weekEnd, leadershipPts, leadershipNote, frPts, frNote, reviewsPts, reviewsNote } = body;

  if (!techId || !weekEnd) return NextResponse.json({ error: 'Missing techId or weekEnd' }, { status: 400 });

  const tech = await prisma.technician.findUnique({ where: { techId } });
  if (!tech) return NextResponse.json({ error: 'Tech not found' }, { status: 404 });

  const weekEndDate = new Date(weekEnd + 'T00:00:00.000Z');
  const totalPoints = (leadershipPts || 0) + (frPts || 0) + (reviewsPts || 0);

  const adj = await prisma.manualAdj.create({
    data: {
      technicianId: tech.id,
      techId,
      weekEnd: weekEndDate,
      totalPoints,
      leadershipPts: leadershipPts || 0,
      leadershipNote,
      frPts: frPts || 0,
      frNote,
      reviewsPts: reviewsPts || 0,
      reviewsNote,
      enteredBy: (session.user as any)?.email,
    },
  });

  // Apply adjustment to tech_weeks totalScore
  const techWeek = await prisma.techWeek.findFirst({
    where: {
      techId,
      weekEnd: { gte: weekEndDate, lt: new Date(weekEndDate.getTime() + 24 * 60 * 60 * 1000) },
    },
  });

  if (techWeek) {
    await prisma.techWeek.update({
      where: { id: techWeek.id },
      data: {
        manualAdj: (techWeek.manualAdj || 0) + totalPoints,
        totalScore: (techWeek.totalScore || 0) + totalPoints,
      },
    });
  }

  return NextResponse.json(adj);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any)?.role;
  if (!['ADMIN'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const adj = await prisma.manualAdj.findUnique({ where: { id } });
  if (!adj) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Reverse the adjustment from tech_weeks
  const techWeek = await prisma.techWeek.findFirst({
    where: {
      techId: adj.techId,
      weekEnd: { gte: adj.weekEnd, lt: new Date(adj.weekEnd.getTime() + 24 * 60 * 60 * 1000) },
    },
  });

  if (techWeek) {
    await prisma.techWeek.update({
      where: { id: techWeek.id },
      data: {
        manualAdj: (techWeek.manualAdj || 0) - adj.totalPoints,
        totalScore: (techWeek.totalScore || 0) - adj.totalPoints,
      },
    });
  }

  await prisma.manualAdj.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
