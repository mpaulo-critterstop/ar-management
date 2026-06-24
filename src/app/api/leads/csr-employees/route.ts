import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const employees = await prisma.csrEmployee.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
  return NextResponse.json({ employees });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { frEmployeeId, name } = await req.json();
  if (!frEmployeeId || !name) {
    return NextResponse.json({ error: 'frEmployeeId and name are required' }, { status: 400 });
  }

  const employee = await prisma.csrEmployee.create({
    data: { frEmployeeId, name, active: true },
  });
  return NextResponse.json({ employee });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, name, active, frEmployeeId } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const employee = await prisma.csrEmployee.update({
    where: { id },
    data: { ...(name !== undefined && { name }), ...(active !== undefined && { active }), ...(frEmployeeId !== undefined && { frEmployeeId }) },
  });
  return NextResponse.json({ employee });
}
