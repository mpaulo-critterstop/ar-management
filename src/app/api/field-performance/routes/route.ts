// src/app/api/field-performance/routes/route.ts
// Session-gated PC Routes data for the Field Performance "Routes" tab.
// Per-route raw data from tech_routes (production, completion counts) grouped by tech.
// Mirrors the routeDetail diagnostic but with session + module gating and leader filtering.

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const officeParam = searchParams.get('office');
  const office = officeParam && officeParam !== 'ALL' ? officeParam : undefined;
  const weekEndParam = searchParams.get('weekEnd');
  const leaderFilter = (searchParams.get('leader') || '').toLowerCase();

  if (!weekEndParam) return NextResponse.json({ error: 'weekEnd required' }, { status: 400 });
  const weekEnd = new Date(weekEndParam + 'T00:00:00.000Z');

  // Per-route rows for the week (+ optional office), joined to tech + their computed TechWeek values.
  const rows = await prisma.$queryRaw<Array<{
    techId: string; name: string; team: string; office: string; frRouteId: string;
    date: Date; completed: number; pending: number; noShow: number; productionValue: number;
    hrDays: number | null; crewLeader: string | null; siteLeader: string | null;
    twRevEff: number | null; twCompletion: number | null; twProduction: number | null;
  }>>`
    SELECT r."techId", t.name, t.team::text as team, r.office, r."frRouteId", r.date,
           r.completed, r.pending, r."noShow", r."productionValue",
           t."hrDays", t."crewLeader", t."siteLeader",
           tw."revenueEfficiency" as "twRevEff", tw."completionPct" as "twCompletion",
           tw."productionValue" as "twProduction"
    FROM tech_routes r
    JOIN technicians t ON t."techId" = r."techId"
    LEFT JOIN tech_weeks tw ON tw."techId" = r."techId" AND tw."weekEnd" = r."weekEnd"
    WHERE r."weekEnd" = ${weekEnd}
      ${office ? Prisma.sql`AND r.office = ${office}` : Prisma.empty}
    ORDER BY t.name, r.date
  `;

  // Group by tech.
  const byTech = new Map<string, any>();
  for (const r of rows) {
    if (leaderFilter && !(r.crewLeader || '').toLowerCase().includes(leaderFilter) && !(r.siteLeader || '').toLowerCase().includes(leaderFilter)) continue;
    if (!byTech.has(r.techId)) {
      byTech.set(r.techId, {
        techId: r.techId, name: r.name, team: r.team, office: r.office,
        hrDays: r.hrDays, crewLeader: r.crewLeader, siteLeader: r.siteLeader,
        routes: [], totalProduction: 0, productiveDays: 0,
        totalCompleted: 0, totalPending: 0, totalNoShow: 0,
        // Authoritative computed values from TechWeek (same source as the Individuals tab).
        completionPct: r.twCompletion,
        revEff: r.twRevEff,
        weekProduction: r.twProduction,
      });
    }
    const g = byTech.get(r.techId);
    g.routes.push({
      date: r.date.toISOString().split('T')[0],
      frRouteId: r.frRouteId,
      productionValue: r.productionValue,
      completed: r.completed, pending: r.pending, noShow: r.noShow,
    });
    g.totalProduction += r.productionValue;
    g.totalCompleted += r.completed;
    g.totalPending += r.pending;
    g.totalNoShow += r.noShow;
    if (r.productionValue > 0) g.productiveDays++;
  }

  const techs = [...byTech.values()].map(g => ({
    ...g,
    totalProduction: Math.round(g.totalProduction * 100) / 100,
    routeCount: g.routes.length,
    // completionPct + revEff already set from TechWeek (authoritative).
  }));

  return NextResponse.json({
    weekEnd: weekEnd.toISOString().split('T')[0],
    office: office || 'ALL',
    techCount: techs.length,
    techs,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
