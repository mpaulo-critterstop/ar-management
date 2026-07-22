import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any)?.role;
  if (!['Admin', 'Manager'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get('year') || '2026');
  const officeParam = searchParams.get('office');

  // Get all tech weeks for the year
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  const where: any = {
    weekEnd: { gte: yearStart, lt: yearEnd },
    totalScore: { not: null },
  };
  if (officeParam && officeParam !== 'ALL') where.office = officeParam;

  const weeks = await prisma.techWeek.findMany({
    where,
    include: { technician: { select: { name: true, status: true, crewLeader: true, siteLeader: true } } },
    orderBy: { weekEnd: 'asc' },
  });

  // The 8 MoM metrics (matches the FPEM MoM sheet). key → TechWeek field + higher-is-better flag + standard.
  const METRICS = [
    { key: 'totalScore',       label: 'Total Effort Meter',  field: 'totalScore',        standard: 0.90, higher: true },
    { key: 'closeOutPct',      label: '+1 Wk CO %',          field: 'closeOutPct',       standard: 0.85, higher: true },
    { key: 'callbackRate',     label: '60 Day CB Rate',      field: 'callbackRate',      standard: 0.15, higher: false },
    { key: 'revenueEfficiency',label: 'Pest Revenue Eff.',   field: 'revenueEfficiency', standard: 0.90, higher: true },
    { key: 'reseviceRate',     label: 'Reservice Rate',      field: 'reseviceRate',      standard: 0.10, higher: false },
    { key: 'completionPct',    label: 'Completion %',        field: 'completionPct',     standard: 0.95, higher: true },
    { key: 'drivingScore',     label: 'Driving Effort',      field: 'drivingScore',      standard: 0.90, higher: true },
    { key: 'reliabilityScore', label: 'Reliability Score',   field: 'reliabilityScore',  standard: 0.90, higher: true },
  ];

  const months = [1,2,3,4,5,6,7,8,9,10,11,12];
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  // Per tech: for each metric, collect monthly buckets + ytd of non-null weekly values.
  type MetricAgg = { monthly: Record<number, number[]>; ytd: number[] };
  const techMap = new Map<string, {
    techId: string; name: string; office: string; team: string;
    crewLeader: string | null; siteLeader: string | null; status: string;
    metrics: Record<string, MetricAgg>;
  }>();

  for (const w of weeks) {
    const month = new Date(w.weekEnd).getUTCMonth() + 1;
    if (!techMap.has(w.techId)) {
      techMap.set(w.techId, {
        techId: w.techId,
        name: w.technician.name,
        office: w.office,
        team: w.team,
        crewLeader: (w.technician as any).crewLeader ?? null,
        siteLeader: (w.technician as any).siteLeader ?? null,
        status: (w.technician as any).status ?? 'ACTIVE',
        metrics: Object.fromEntries(METRICS.map(m => [m.key, { monthly: {}, ytd: [] }])),
      });
    }
    const entry = techMap.get(w.techId)!;
    for (const m of METRICS) {
      const val = (w as any)[m.field];
      if (val === null || val === undefined) continue;
      const agg = entry.metrics[m.key];
      if (!agg.monthly[month]) agg.monthly[month] = [];
      agg.monthly[month].push(val);
      agg.ytd.push(val);
    }
  }

  // Build per-tech output: each metric → { ytd, monthly{1..12} }.
  const techs = [...techMap.values()].map(t => ({
    techId: t.techId,
    name: t.name,
    office: t.office,
    team: t.team,
    crewLeader: t.crewLeader,
    siteLeader: t.siteLeader,
    status: t.status,
    metrics: Object.fromEntries(METRICS.map(m => {
      const agg = t.metrics[m.key];
      return [m.key, {
        ytd: avg(agg.ytd),
        monthly: Object.fromEntries(months.map(mo => [mo, avg(agg.monthly[mo] || [])])),
      }];
    })),
  }));

  // Team-average row per metric: average across all techs' weekly values (pooled).
  const teamAverages: Record<string, { ytd: number | null; monthly: Record<number, number | null> }> = {};
  for (const m of METRICS) {
    const allYtd: number[] = [];
    const monthlyPool: Record<number, number[]> = {};
    for (const t of techMap.values()) {
      const agg = t.metrics[m.key];
      allYtd.push(...agg.ytd);
      for (const mo of months) {
        if (agg.monthly[mo]) { (monthlyPool[mo] ||= []).push(...agg.monthly[mo]); }
      }
    }
    teamAverages[m.key] = {
      ytd: avg(allYtd),
      monthly: Object.fromEntries(months.map(mo => [mo, avg(monthlyPool[mo] || [])])),
    };
  }

  return NextResponse.json({
    year,
    metrics: METRICS.map(({ key, label, standard, higher }) => ({ key, label, standard, higher })),
    techs,
    teamAverages,
  });
}
