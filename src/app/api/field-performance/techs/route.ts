import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const office = searchParams.get('office');

  const where: any = { status: 'ACTIVE' };
  if (office && office !== 'ALL') where.office = office;

  const techs = await prisma.technician.findMany({
    where,
    select: { techId: true, name: true, office: true, team: true },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(techs);
}
