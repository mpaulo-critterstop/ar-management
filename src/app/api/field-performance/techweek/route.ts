import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function canAccess(role: string) {
  return ['Admin', 'Manager'].includes(role);
}

// Standards from spreadsheet
const STANDARDS = { co: 0.85, cb: 0.15, revenueEff: 0.90, reservice: 0.10, completion: 0.95, driving: 0.90, reliability: 0.90 };
const WEIGHTS = {
  WP:  { co: 0.45, cb: 0.30, driving: 0.10, reliability: 0.15 },
  PMP: { revenueEff: 0.35, reservice: 0.20, completion: 0.20, driving: 0.10, reliability: 0.15 },
  IP:  { driving: 0.50, reliability: 0.50 },
};

function calcWPScore(co: number, cb: number | null, drv: number, rel: number): number {
  const coTerm = Math.min(co + (1 - STANDARDS.co), 1.1) * WEIGHTS.WP.co;
  const cbTerm = cb !== null
    ? ((1 + STANDARDS.cb * 2) - cb * 2) * WEIGHTS.WP.cb
    : Math.min(co + (1 - STANDARDS.co), 1.1) * WEIGHTS.WP.cb;
  return coTerm + cbTerm + drv * WEIGHTS.WP.driving + rel * WEIGHTS.WP.reliability;
}

function calcPMPScore(revEff: number, resv: number, comp: number, drv: number, rel: number): number {
  return (
    revEff * WEIGHTS.PMP.revenueEff +
    (0.95 + STANDARDS.reservice - resv) * WEIGHTS.PMP.reservice +
    (1 - (STANDARDS.completion - comp) * 5) * WEIGHTS.PMP.completion +
    drv * WEIGHTS.PMP.driving +
    rel * WEIGHTS.PMP.reliability
  );
}

function calcIPScore(drv: number, rel: number): number {
  return drv * WEIGHTS.IP.driving + rel * WEIGHTS.IP.reliability;
}

function calcReliability(minutesLate: number, utilization: number): number {
  return Math.min((105 - minutesLate * 2) * 0.5 + (utilization * 100) * 0.5, 110) / 100;
}

function calcDriving(alertsPer1k: number, maxSpeed: number, idleRatio: number): number {
  const speedPenalty = maxSpeed > 90 ? 50 : maxSpeed > 80 ? 8 : 0;
  const idlePenalty = idleRatio > 0.30 ? (idleRatio - 0.30) * 50 : 0;
  return Math.min((102 - alertsPer1k - speedPenalty - idlePenalty) / 100, 1.05);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role;
  if (!canAccess(role) && role !== 'Technician') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get('week');
  const monthStart = searchParams.get('monthStart');
  const monthEnd = searchParams.get('monthEnd');
  const techId = searchParams.get('techId');
  const officeParam = searchParams.get('office');

  const where: any = {};
  if (monthStart && monthEnd) {
    where.weekEnd = { gte: new Date(monthStart), lte: new Date(monthEnd) };
  } else if (weekParam) {
    where.weekEnd = new Date(weekParam);
  }
  if (techId) where.techId = techId;
  if (officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN') where.office = officeParam;

  const isMonth = !!(monthStart && monthEnd);

  // Fetch all TechWeek records for the week
  const weeksRaw = await prisma.techWeek.findMany({
    where: { ...where, technician: { status: 'ACTIVE' } },
    include: { technician: { select: { name: true, status: true, team: true, office: true, crewLeader: true, siteLeader: true } } },
    orderBy: [{ weekEnd: 'desc' }, { totalScore: 'desc' }],
  });
  // Surface leader fields at the row top-level for easy client-side filtering.
  const weeks = weeksRaw.map((w: any) => ({
    ...w,
    crewLeader: w.technician?.crewLeader ?? null,
    siteLeader: w.technician?.siteLeader ?? null,
  }));

  // Fetch all active techs not in TechWeek records
  const techsWithWeek = new Set(weeks.map((w: any) => w.techId));
  const techWhere: any = { status: 'ACTIVE' };
  if (officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN') techWhere.office = officeParam;

  const allActiveTechs = await prisma.technician.findMany({
    where: techWhere,
    select: { techId: true, name: true, team: true, office: true, status: true, crewLeader: true, siteLeader: true },
  });

  // Build stub records for techs without TechWeek entries
  const stubWeeks = allActiveTechs
    .filter((t: any) => !techsWithWeek.has(t.techId))
    .map((t: any) => ({
      id: `stub_${t.techId}`,
      techId: t.techId,
      weekEnd: weekParam ? new Date(weekParam) : null,
      office: t.office,
      team: t.team,
      crewLeader: t.crewLeader ?? null,
      siteLeader: t.siteLeader ?? null,
      totalScore: null,
      pmpScore: null,
      completionPct: null,
      productionValue: null,
      revenueEfficiency: null,
      reseviceRate: null,
      drivingScore: null,
      reliabilityScore: null,
      closeOutPct: null,
      callbackRate: null,
      manualAdj: 0,
      technician: { name: t.name, status: t.status, team: t.team, office: t.office, crewLeader: t.crewLeader, siteLeader: t.siteLeader },
    }));

  if (!isMonth) {
    return NextResponse.json([...weeks, ...stubWeeks]);
  }

  // MONTH MODE: collapse multiple weekly rows per tech into one aggregated row.
  // Scores/rates → average of non-null weekly values; counts/production → sum.
  const avgFields = ['totalScore','wpScore','pmpScore','ipScore','closeOutPct','callbackRate',
    'revenueEfficiency','reseviceRate','completionPct','drivingScore','reliabilityScore',
    'maxSpeed','safetyAlertsPer1k','idleRatio'];
  const sumFields = ['coJobs','callbackJobs','productionValue','manualAdj','reviewCount'];

  const byTech = new Map<string, any[]>();
  for (const w of weeks) {
    if (!byTech.has(w.techId)) byTech.set(w.techId, []);
    byTech.get(w.techId)!.push(w);
  }

  const aggregated = [...byTech.values()].map(rows => {
    const first = rows[0];
    const out: any = {
      id: `month_${first.techId}`,
      techId: first.techId,
      weekEnd: null,
      weeksInMonth: rows.length,
      office: first.office,
      team: first.team,
      crewLeader: first.crewLeader ?? null,
      siteLeader: first.siteLeader ?? null,
      technician: first.technician,
    };
    for (const f of avgFields) {
      const vals = rows.map(r => r[f]).filter((v: any) => v !== null && v !== undefined);
      out[f] = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;
    }
    for (const f of sumFields) {
      const vals = rows.map(r => r[f]).filter((v: any) => v !== null && v !== undefined);
      out[f] = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) : (f === 'manualAdj' ? 0 : null);
    }
    return out;
  }).sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1));

  return NextResponse.json(aggregated);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role;
  if (!canAccess(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { techId, weekEnd, ...metrics } = body;

  if (!techId || !weekEnd) return NextResponse.json({ error: 'Missing techId or weekEnd' }, { status: 400 });

  const tech = await prisma.technician.findUnique({ where: { techId } });
  if (!tech) return NextResponse.json({ error: 'Technician not found' }, { status: 404 });

  // Calculate driving score if raw inputs provided
  let drivingScore = metrics.drivingScore;
  if (metrics.safetyAlertsPer1k !== undefined && metrics.maxSpeed !== undefined && metrics.idleRatio !== undefined) {
    drivingScore = calcDriving(metrics.safetyAlertsPer1k, metrics.maxSpeed, metrics.idleRatio);
  }

  // Calculate reliability score if raw inputs provided
  let reliabilityScore = metrics.reliabilityScore;
  if (metrics.minutesLate !== undefined && metrics.utilization !== undefined) {
    reliabilityScore = calcReliability(metrics.minutesLate, metrics.utilization);
  }

  // Calculate team score. manualAdj is in POINTS (1 pt = 1% = 0.01 decimal).
  let wpScore = null, pmpScore = null, ipScore = null, totalScore = null;
  const adjDec = (metrics.manualAdj ?? 0) / 100;
  if (tech.team === 'WP' && metrics.closeOutPct !== undefined && drivingScore !== undefined && reliabilityScore !== undefined) {
    wpScore = calcWPScore(metrics.closeOutPct, metrics.callbackRate ?? null, drivingScore, reliabilityScore);
    totalScore = wpScore + adjDec;
  } else if (tech.team === 'PMP' && metrics.revenueEfficiency !== undefined && metrics.reseviceRate !== undefined && metrics.completionPct !== undefined && drivingScore !== undefined && reliabilityScore !== undefined) {
    pmpScore = calcPMPScore(metrics.revenueEfficiency, metrics.reseviceRate, metrics.completionPct, drivingScore, reliabilityScore);
    totalScore = pmpScore + adjDec;
  } else if (tech.team === 'IP' && drivingScore !== undefined && reliabilityScore !== undefined) {
    ipScore = calcIPScore(drivingScore, reliabilityScore);
    totalScore = ipScore + adjDec;
  }

  const weekEndDate = new Date(weekEnd + "T00:00:00.000Z");

  const data = {
    technicianId: tech.id,
    techId,
    weekEnd: weekEndDate,
    office: tech.office,
    team: tech.team,
    siteLeader: tech.siteLeader,
    crewLeader: tech.crewLeader,
    totalScore,
    wpScore,
    pmpScore,
    ipScore,
    drivingScore,
    reliabilityScore,
    ...metrics,
  };

  const record = await prisma.techWeek.upsert({
    where: { techId_weekEnd: { techId, weekEnd: weekEndDate } },
    update: data,
    create: data,
  });

  return NextResponse.json(record);
}
