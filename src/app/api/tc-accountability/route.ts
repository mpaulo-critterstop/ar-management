// src/app/api/tc-accountability/route.ts
// Returns TC accountability records for a given week

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const weekEnd = searchParams.get('weekEnd');
  const monthStart = searchParams.get('monthStart');
  const monthEnd = searchParams.get('monthEnd');
  const office = searchParams.get('office') || 'ALL';
  const techId = searchParams.get('techId') || '';

  const where: any = {};
  if (monthStart && monthEnd) {
    where.weekEnd = { gte: new Date(monthStart), lte: new Date(monthEnd) };
  } else if (weekEnd) {
    where.weekEnd = new Date(weekEnd + 'T00:00:00.000Z');
  } else {
    return NextResponse.json({ error: 'weekEnd or month required' }, { status: 400 });
  }
  if (office !== 'ALL') where.office = office;
  if (techId) where.techId = techId;

  const records = await prisma.tcAppointment.findMany({
    where,
    orderBy: [{ date: 'asc' }, { techName: 'asc' }],
    take: 5000,
  });

  // Attach team-leader info by mapping techId → Technician (tc_appointments has no relation).
  const techIds = [...new Set(records.map((r: any) => r.techId).filter(Boolean))];
  const techs = techIds.length
    ? await prisma.technician.findMany({
        where: { techId: { in: techIds as string[] } },
        select: { techId: true, crewLeader: true, siteLeader: true },
      })
    : [];
  const leaderMap = new Map(techs.map((t: any) => [t.techId, { crewLeader: t.crewLeader, siteLeader: t.siteLeader }]));
  const recordsWithLeaders = records.map((r: any) => ({
    ...r,
    crewLeader: leaderMap.get(r.techId)?.crewLeader ?? null,
    siteLeader: leaderMap.get(r.techId)?.siteLeader ?? null,
  }));

  return NextResponse.json({ records: recordsWithLeaders });
}
