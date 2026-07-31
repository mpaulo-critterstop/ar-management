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

  // ── Cutover: months < COMPUTE_FROM use imported/stored sheet values (source of truth through July);
  // months >= COMPUTE_FROM compute live from scores. August 2026 = first computed month.
  const COMPUTE_FROM = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01

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
  // Kyle Oktay is a service manager, not a crew leader — never treat him as one.
  const NON_LEADERS = new Set(['Kyle Oktay']);
  for (const n of NON_LEADERS) leaderNames.delete(n);
  const leaderTechs = activeTechs.filter(t => leaderNames.has(t.name) && !NON_LEADERS.has(t.name));

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

  // ── Days worked per tech per month (gatekeeper: >12 days) — count WORKED attendance rows.
  const attendance = await prisma.techDayAttendance.findMany({
    where: { date: { gte: yearStart, lt: yearEnd }, status: 'WORKED' },
    select: { techId: true, date: true },
  });
  const daysPool = new Map<string, Record<number, number>>();
  for (const a of attendance) {
    const m = new Date(a.date).getUTCMonth();
    if (!daysPool.has(a.techId)) daysPool.set(a.techId, {});
    daysPool.get(a.techId)![m] = (daysPool.get(a.techId)![m] || 0) + 1;
  }
  const daysWorked = (techId: string, m0: number) => daysPool.get(techId)?.[m0] || 0;
  const meetsGate = (techId: string, m0: number) => daysWorked(techId, m0) > 12;

  // Field-pro bonus tiers, split into immediate + Christmas-accrued halves (spec):
  //   TEM 93.0-97.9 -> $200 ($100 now + $100 accrued);  TEM >=98.0 -> $300 ($150 + $150).
  // Gated by >12 days worked that month.
  const fpBonus = (techId: string, s: number | null, m0: number): { immediate: number; accrued: number } => {
    if (!meetsGate(techId, m0) || s == null) return { immediate: 0, accrued: 0 };
    if (s >= 0.98) return { immediate: 150, accrued: 150 };
    if (s >= 0.93) return { immediate: 100, accrued: 100 };
    return { immediate: 0, accrued: 0 };
  };

  // Stored bonus rows indexed: kind -> techId -> monthKey -> summed amount.
  const stored = new Map<string, Map<string, Record<string, number>>>();
  for (const b of bonuses) {
    if (!stored.has(b.kind)) stored.set(b.kind, new Map());
    const byTech = stored.get(b.kind)!;
    if (!byTech.has(b.techId)) byTech.set(b.techId, {});
    const mk = monthKey(new Date(b.month));
    byTech.get(b.techId)![mk] = (byTech.get(b.techId)![mk] || 0) + b.amount;
  }

  // Summary accumulators (YTD, office-filtered).
  let sumImmediate = 0, sumAccrued = 0;

  // ── Field Professional grid. Crew leaders are shown in the Team block only (not here).
  const leaderNameSet = new Set(leaderTechs.map(l => l.name));
  function buildFieldPro() {
    const rows: any[] = [];
    for (const t of activeTechs) {
      if (leaderNameSet.has(t.name)) continue; // crew leaders excluded from FP block
      const amounts: Record<string, number> = {};       // total per month (for the grid cells)
      let ytd = 0, immediate = 0, accrued = 0;
      for (let m0 = 0; m0 < 12; m0++) {
        const mk = months[m0];
        let mImm = 0, mAcc = 0;
        if (isComputed(m0)) {
          const b = fpBonus(t.techId, monthlyScore(t.techId, m0), m0);
          mImm += b.immediate; mAcc += b.accrued;
        }
        // Stored rows (imported history OR manual adjustments): the stored value is the immediate
        // (paid) amount; per spec each paid $ has an equal Christmas-accrued twin.
        const manual = stored.get('field_professional')?.get(t.techId)?.[mk] || 0;
        mImm += manual;
        if (manual) mAcc += manual; // matching accrual for stored/imported payments
        const total = mImm + mAcc;
        if (mImm) { amounts[mk] = mImm; ytd += mImm; immediate += mImm; accrued += mAcc; }
      }
      sumImmediate += immediate; sumAccrued += accrued;
      rows.push({ techId: t.techId, techName: t.name, crewLeader: t.crewLeader, office: t.office, amounts, ytd, immediate, accrued });
    }
    return rows.sort((a, b) => a.techId.localeCompare(b.techId));
  }

  // ── Team grid (per crew leader): leader tier + 50% gated team share.
  function buildTeam() {
    const rows: any[] = [];
    for (const leader of leaderTechs) {
      const amounts: Record<string, number> = {};
      let ytd = 0, immediate = 0, accrued = 0;
      const members = activeTechs.filter(t => t.crewLeader === leader.name);
      for (let m0 = 0; m0 < 12; m0++) {
        const mk = months[m0];
        let mImm = 0, mAcc = 0;
        if (isComputed(m0)) {
          const leaderScore = monthlyScore(leader.techId, m0);
          // Part 1: leader's own individual bonus (same tiers/gate as a field pro).
          const own = fpBonus(leader.techId, leaderScore, m0);
          mImm += own.immediate; mAcc += own.accrued;
          // Part 2: team-driven — 50% of team's summed field-pro bonuses, split 50/50 immediate/accrued,
          // gated on leader TEM >= 0.93 AND team-avg TEM > 0.90.
          const memberScores = members.map(mem => monthlyScore(mem.techId, m0)).filter(s => s != null) as number[];
          const teamAvg = memberScores.length ? avg(memberScores)! : null;
          if (leaderScore != null && leaderScore >= 0.93 && teamAvg != null && teamAvg > 0.90) {
            // Sum the FULL team member bonuses ($100/$150 tiers, gated per member), take 50%.
            const teamFull = members.reduce((sum, mem) => {
              const mb = fpBonus(mem.techId, monthlyScore(mem.techId, m0), m0);
              return sum + mb.immediate + mb.accrued; // full ($200/$300) per member
            }, 0);
            // Spec: 50% of that pool, itself split 50% monthly / 50% accrued.
            const share = teamFull * 0.5;
            mImm += share * 0.5;
            mAcc += share * 0.5;
          }
        }
        const manual = stored.get('team')?.get(leader.techId)?.[mk] || 0;
        mImm += manual;
        if (manual) mAcc += manual; // matching accrual for stored/imported payments
        if (mImm) { amounts[mk] = mImm; ytd += mImm; immediate += mImm; accrued += mAcc; }
      }
      sumImmediate += immediate; sumAccrued += accrued;
      rows.push({ techId: leader.techId, techName: leader.name, crewLeader: leader.name, office: leader.office, amounts, ytd, immediate, accrued });
    }
    return rows.sort((a, b) => a.techId.localeCompare(b.techId));
  }

  const fieldPro = buildFieldPro();
  const team = buildTeam();

  // Grand total = every bonus dollar, all people, all months (matches sheet V363).
  const grandTotal = [...fieldPro, ...team].reduce((s, r) => s + r.ytd, 0);

  return NextResponse.json({
    year, months,
    computeFrom: COMPUTE_FROM.toISOString().slice(0, 7),
    team, fieldPro,
    summary: {
      totalYtd: Math.round(grandTotal),             // headline: total bonuses paid YTD
      christmasAccrued: Math.round(sumAccrued),     // for the separate Christmas-accrual view
    },
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
