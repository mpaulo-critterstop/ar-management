import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const all = await prisma.employee.findMany({ select: { region: true } });
  const dist: any = {};
  for (const e of all) dist[e.region || 'null'] = (dist[e.region || 'null'] || 0) + 1;
  const intl = await prisma.employee.findMany({ where: { region: 'International' }, select: { fullName: true }, take: 30 });
  return NextResponse.json({ regionDistribution: dist, internationalNames: intl.map(e => e.fullName) });
}
