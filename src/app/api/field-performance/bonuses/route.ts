// Field Performance bonuses — crew-leader and field-professional bonuses paid per month.
// Mirrors the MoM "Bonuses Paid" section of the Excel.
// GET  /api/field-performance/bonuses?year=2026[&office=DFW]  -> { year, months, crewLeader[], fieldPro[] }
// POST /api/field-performance/bonuses  { techId, kind, month, amount, note? }  -> creates one
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const year = parseInt(req.nextUrl.searchParams.get('year') || '2026');
  const office = req.nextUrl.searchParams.get('office');
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const where: any = { month: { gte: start, lte: end } };
  if (office && office !== 'ALL' && office !== 'ADMIN' && office !== 'All') where.office = office;

  // ── Cutover: months < COMPUTE_FROM use imported/stored Bonus rows; months >= COMPUTE_FROM
  // are computed live from monthly scores (formula), with any stored Bonus row treated as a manual
  // adjustment that STACKS on top of the computed amount. July 2026 = first computed month.
  const COMPUTE_FROM = new Date(Date.UTC(2026, 6, 1)); // 2026-07-01 (month index 6 = July)

  const bonuses = await prisma.bonus.findMany({ where, orderBy: [{ techId: 'asc' }, { month: 'asc' }] });

  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(year, i + 1, 0)).toISOString().slice(0, 10)
  );
  const monthKey = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const isComputed = (monthIdx0: number) => new Date(Date.UTC(year, monthIdx0, 1)) >= COMPUTE_FROM;

  // Roster for zero-fill: all ACTIVE techs.
  const techWhere: any = { status: 'ACTIVE' };
  if (office && office !== 'ALL' && office !== 'ADMIN' && office !== 'All') techWhere.office = office;
  const activeTechs = await prisma.technician.findMany({
    where: techWhere,
    select: { techId: true, name: true, office: true, crewLeader: true },
  });
  const leaderNames = new Set(activeTechs.map(t => t.crewLeader).filter(Boolean) as string[]);
  const leaderTechs = activeTechs.filter(t => leaderNames.has(t.name));

  // ── Monthly scores per tech (avg of weekly totalScores in the month) — matches MoM/AVERAGEIFS.
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const weeks = await prisma.techWeek.findMany({
    where: { weekEnd: { gte: yearStart, lt: yearEnd }, totalScore: { not: null } },
    select: { techId: true, weekEnd: true, totalScore: true, crewLeader: true, office: true },
  });
  // techId -> monthIdx0 -> [scores]
  const scorePool = new Map<string, Record<number, number[]>>();
  const crewByTech = new Map<string, string | null>();
  for (const w of weeks) {
    const m = new Date(w.weekEnd).getUTCMonth();
    if (!scorePool.has(w.techId)) scorePool.set(w.techId, {});
    (scorePool.get(w.techId)![m] ||= []).push(w.totalScore!);
    crewByTech.set(w.techId, w.crewLeader ?? null);
  }
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const monthlyScore = (techId: string, m0: number): number | null => {
    const pool = scorePool.get(techId)?.[m0];
    return pool && pool.length ? avg(pool) : null;
  };
  // Field-pro bonus tier from a monthly score.
  const fpTier = (s: number | null): number => (s == null ? 0 : s >= 0.98 ? 150 : s >= 0.93 ? 100 : 0);

  // Stored bonus rows indexed: kind -> techId -> monthKey -> summed amount.
  const stored = new Map<string, Map<string, Record<string, number>>>();
  for (const b of bonuses) {
    if (!stored.has(b.kind)) stored.set(b.kind, new Map());
    const byTech = stored.get(b.kind)!;
    if (!byTech.has(b.techId)) byTech.set(b.techId, {});
    const mk = monthKey(new Date(b.month));
    byTech.get(b.techId)![mk] = (byTech.get(b.techId)![mk] || 0) + b.amount;
  }

  // ── Field Professional grid: computed tier (computed months) + stored (all months, stacks).
  function buildFieldPro() {
    const rows: any[] = [];
    for (const t of activeTechs) {
      const amounts: Record<string, number> = {};
      const computedFlag: Record<string, boolean> = {};
      let ytd = 0;
      for (let m0 = 0; m0 < 12; m0++) {
        const mk = months[m0];
        let amt = 0;
        if (isComputed(m0)) { amt += fpTier(monthlyScore(t.techId, m0)); computedFlag[mk] = true; }
        const manual = stored.get('field_professional')?.get(t.techId)?.[mk] || 0;
        amt += manual;
        if (amt) { amounts[mk] = amt; ytd += amt; }
      }
      rows.push({ techId: t.techId, techName: t.name, crewLeader: t.crewLeader, office: t.office, amounts, ytd, computedFlag });
    }
    return rows.sort((a, b) => a.techId.localeCompare(b.techId));
  }

  // ── Team grid (per crew leader): leader tier + 50% gated team share, + stored (stacks).
  function buildTeam() {
    const rows: any[] = [];
    for (const leader of leaderTechs) {
      const amounts: Record<string, number> = {};
      const computedFlag: Record<string, boolean> = {};
      let ytd = 0;
      // team members = active techs whose crewLeader is this leader's name.
      const members = activeTechs.filter(t => t.crewLeader === leader.name);
      for (let m0 = 0; m0 < 12; m0++) {
        const mk = months[m0];
        let amt = 0;
        if (isComputed(m0)) {
          const leaderScore = monthlyScore(leader.techId, m0);
          // Part 1: leader's own tier
          amt += fpTier(leaderScore);
          // Part 2: 50% of team's summed field-pro bonuses, gated on leader>=0.93 AND team avg>0.90
          const memberScores = members.map(mem => monthlyScore(mem.techId, m0)).filter(s => s != null) as number[];
          const teamAvg = memberScores.length ? avg(memberScores)! : null;
          if (leaderScore != null && leaderScore >= 0.93 && teamAvg != null && teamAvg > 0.90) {
            const teamFpSum = members.reduce((sum, mem) => sum + fpTier(monthlyScore(mem.techId, m0)), 0);
            amt += teamFpSum * 0.5;
          }
          computedFlag[mk] = true;
        }
        const manual = stored.get('team')?.get(leader.techId)?.[mk] || 0;
        amt += manual;
        if (amt) { amounts[mk] = amt; ytd += amt; }
      }
      rows.push({ techId: leader.techId, techName: leader.name, crewLeader: leader.name, office: leader.office, amounts, ytd, computedFlag });
    }
    return rows.sort((a, b) => a.techId.localeCompare(b.techId));
  }

  return NextResponse.json({
    year, months,
    computeFrom: COMPUTE_FROM.toISOString().slice(0, 7),
    team: buildTeam(),
    fieldPro: buildFieldPro(),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role;
  if (!['Admin', 'Manager'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden — Admin/Manager only' }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const { techId, kind, month, amount, note } = b;
  if (!techId || !kind || !month || amount == null) {
    return NextResponse.json({ error: 'techId, kind, month, amount required' }, { status: 400 });
  }
  if (kind !== 'team' && kind !== 'field_professional') {
    return NextResponse.json({ error: 'kind must be team or field_professional' }, { status: 400 });
  }

  // Resolve tech details for denormalized display.
  const tech = await prisma.technician.findUnique({ where: { techId } });
  if (!tech) return NextResponse.json({ error: `Unknown techId ${techId}` }, { status: 404 });

  // Normalize month to that month's end (UTC), matching the sheet's column convention.
  const d = new Date(month);
  const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const created = await prisma.bonus.create({
    data: {
      techId, techName: tech.name, crewLeader: tech.crewLeader ?? null,
      office: tech.office, kind, month: monthEnd, amount: Number(amount),
      note: note || null, updatedAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true, bonus: created });
}
