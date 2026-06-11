import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function canAccess(role: string) {
  return ['ADMIN', 'MANAGER', 'LEADERSHIP'].includes(role);
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
  if (!canAccess(role) && role !== 'TECHNICIAN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get('week');
  const techId = searchParams.get('techId');
  const officeParam = searchParams.get('office');

  const where: any = {};
  if (weekParam) where.weekEnd = new Date(weekParam);
  if (techId) where.techId = techId;
  if (officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN') where.office = officeParam;

  const weeks = await prisma.techWeek.findMany({
    where,
    include: { technician: { select: { name: true, status: true } } },
    orderBy: [{ weekEnd: 'desc' }, { totalScore: 'desc' }],
  });

  return NextResponse.json(weeks);
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

  // Calculate team score
  let wpScore = null, pmpScore = null, ipScore = null, totalScore = null;
  if (tech.team === 'WP' && metrics.closeOutPct !== undefined && drivingScore !== undefined && reliabilityScore !== undefined) {
    wpScore = calcWPScore(metrics.closeOutPct, metrics.callbackRate ?? null, drivingScore, reliabilityScore);
    totalScore = wpScore + (metrics.manualAdj ?? 0);
  } else if (tech.team === 'PMP' && metrics.revenueEfficiency !== undefined && metrics.reseviceRate !== undefined && metrics.completionPct !== undefined && drivingScore !== undefined && reliabilityScore !== undefined) {
    pmpScore = calcPMPScore(metrics.revenueEfficiency, metrics.reseviceRate, metrics.completionPct, drivingScore, reliabilityScore);
    totalScore = pmpScore + (metrics.manualAdj ?? 0);
  } else if (tech.team === 'IP' && drivingScore !== undefined && reliabilityScore !== undefined) {
    ipScore = calcIPScore(drivingScore, reliabilityScore);
    totalScore = ipScore + (metrics.manualAdj ?? 0);
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
