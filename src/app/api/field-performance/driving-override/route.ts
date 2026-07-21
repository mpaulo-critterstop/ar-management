import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const WEIGHTS = {
  WP:  { co: 0.45, cb: 0.30, driving: 0.10, reliability: 0.15 },
  PMP: { revenueEff: 0.35, reservice: 0.20, completion: 0.20, driving: 0.10, reliability: 0.15 },
  IP:  { driving: 0.50, reliability: 0.50 },
};
const STANDARDS = { co: 0.85, cb: 0.15, reservice: 0.10, completion: 0.95 };

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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role;
  if (!['ADMIN', 'MANAGER', 'LEADERSHIP'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { techId, weekEnd, override, note } = await req.json();
  if (!techId || !weekEnd) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (override && !note) return NextResponse.json({ error: 'Note required when overriding' }, { status: 400 });

  const existing = await prisma.techWeek.findUnique({
    where: { techId_weekEnd: { techId, weekEnd: new Date(weekEnd) } },
  });

  if (!existing) return NextResponse.json({ error: 'Tech week not found' }, { status: 404 });

  // Use 0 for driving if overriding, otherwise restore original Bouncie score
  const effectiveDriving = override ? 0 : (existing.drivingScore ?? 0);

  // Recalculate total score with new driving value
  const updateData: any = {
    drivingOverride: override,
    drivingOverrideNote: override ? note : null,
    updatedAt: new Date(),
  };

  const rel = existing.reliabilityScore ?? 0;
  const adjDec = (existing.manualAdj ?? 0) / 100; // manualAdj stored in points (1 pt = 1%)

  if (existing.team === 'WP' && existing.closeOutPct !== null && rel !== null) {
    const s = calcWPScore(existing.closeOutPct, existing.callbackRate ?? null, effectiveDriving, rel);
    updateData.wpScore = s;
    updateData.totalScore = s + adjDec;
  } else if (existing.team === 'PMP' && existing.revenueEfficiency !== null && existing.reseviceRate !== null && existing.completionPct !== null) {
    const s = calcPMPScore(existing.revenueEfficiency, existing.reseviceRate, existing.completionPct, effectiveDriving, rel);
    updateData.pmpScore = s;
    updateData.totalScore = s + adjDec;
  } else if (existing.team === 'IP') {
    const s = calcIPScore(effectiveDriving, rel);
    updateData.ipScore = s;
    updateData.totalScore = s + adjDec;
  }

  const updated = await prisma.techWeek.update({
    where: { techId_weekEnd: { techId, weekEnd: new Date(weekEnd) } },
    data: updateData,
  });

  return NextResponse.json({ success: true, totalScore: updated.totalScore, drivingOverride: updated.drivingOverride });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { techId, weekEnd } = await req.json();
  return NextResponse.json(await fetch('/api/field-performance/driving-override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ techId, weekEnd, override: false, note: '' }),
  }).then(r => r.json()));
}
