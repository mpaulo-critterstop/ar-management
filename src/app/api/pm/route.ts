import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const pms = await prisma.pM.findMany({ orderBy: [{ office: 'asc' }, { name: 'asc' }] });
    return NextResponse.json(pms);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { name, office } = await req.json();
    const pm = await prisma.pM.create({ data: { name, office } });
    return NextResponse.json(pm);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id, active } = await req.json();
    const pm = await prisma.pM.update({ where: { id }, data: { active } });
    return NextResponse.json(pm);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
