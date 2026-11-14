import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const names = ['Han Bien','Jared Brown','Warren Loignon','Mark Paulo'];
  const us = await prisma.raiseTracker.findMany({ where: { employeeName: { in: names } } });
  const intl = await prisma.intlRaiseTracker.findMany({ where: { employeeName: { in: names } } });
  const allUS = await prisma.raiseTracker.findMany({ select: { payType: true } });
  const dist: any = {};
  for (const r of allUS) dist[r.payType || 'null'] = (dist[r.payType || 'null'] || 0) + 1;
  return NextResponse.json({
    us: us.map(r => ({ name: r.employeeName, payType: r.payType, currentSalary: r.currentSalary })),
    intl: intl.map(r => ({ name: r.employeeName, payType: r.payType, currentSalary: r.currentSalary })),
    usPayTypeDistribution: dist,
  });
}
