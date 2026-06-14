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
  const office = searchParams.get('office') || 'ALL';
  const techId = searchParams.get('techId') || '';

  if (!weekEnd) return NextResponse.json({ error: 'weekEnd required' }, { status: 400 });

  const weekEndDate = new Date(weekEnd + 'T00:00:00.000Z');

  const where: any = { weekEnd: weekEndDate };
  if (office !== 'ALL') where.office = office;
  if (techId) where.techId = techId;

  const records = await prisma.tcAppointment.findMany({
    where,
    orderBy: [{ date: 'asc' }, { techName: 'asc' }],
    take: 1000,
  });

  return NextResponse.json({ records });
}
