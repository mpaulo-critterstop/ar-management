import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.insulationRevenueCache.findMany({
    orderBy: { computedAt: 'desc' }, take: 60,
    select: { period: true, periodKey: true, office: true, periodLabel: true, computedAt: true, totals: true },
  });
  const status = await prisma.appSetting.findUnique({ where: { key: 'insulation_revenue_status' } }).catch(() => null);
  return NextResponse.json({
    lastRunStatus: status?.value || '(none)',
    cacheCount: rows.length,
    week_of_10_05: rows.filter(r => r.period === 'week' && r.periodKey === '2026-10-05'),
    allWeekly: rows.filter(r => r.period === 'week').map(r => ({ key: r.periodKey, office: r.office, jobs: (r.totals as any)?.jobs, rev: (r.totals as any)?.totalRevenue, at: r.computedAt })),
  });
}
