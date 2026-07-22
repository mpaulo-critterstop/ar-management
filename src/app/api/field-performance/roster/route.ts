import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

function canAccess(role: string) {
  return ['Admin', 'Manager'].includes(role);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any).role;
  if (!canAccess(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const office = searchParams.get('office');
  const team = searchParams.get('team');
  const status = searchParams.get('status');

  const where: any = {};
  if (office && office !== 'ALL' && office !== 'ADMIN') where.office = office;
  if (team) where.team = team;
  if (status) where.status = status;

  const techs = await prisma.technician.findMany({
    where,
    include: { bouncieDevice: true },
    orderBy: [{ status: 'asc' }, { team: 'asc' }, { techId: 'asc' }],
  });

  return NextResponse.json(techs);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any).role;
  if (!['Admin', 'Manager'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { techId, name, team, office, hrDays, startTime, siteLeader, crewLeader, hireDate, notes, frEmployeeId } = body;

  if (!techId || !name || !team || !office) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const tech = await prisma.technician.create({
    data: {
      techId,
      name,
      team,
      office,
      hrDays: hrDays || 8,
      startTime: startTime || '8:00 AM',
      siteLeader,
      crewLeader,
      hireDate: hireDate ? new Date(hireDate) : null,
      notes,
      status: 'ACTIVE',
      frEmployeeId: frEmployeeId ? parseInt(frEmployeeId) : null,
    },
  });

  return NextResponse.json(tech);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any).role;
  if (!['Admin', 'Manager'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  if (data.hireDate) data.hireDate = new Date(data.hireDate);
  if (data.termDate) data.termDate = new Date(data.termDate);
  if (data.frEmployeeId) data.frEmployeeId = parseInt(data.frEmployeeId);
  else if (data.frEmployeeId === '') data.frEmployeeId = null;

  const tech = await prisma.technician.update({ where: { id }, data });
  return NextResponse.json(tech);
}
