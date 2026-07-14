// src/app/api/field-performance/completion/route.ts
// Computes 30-day completion% per PMP tech from the tech_routes DB table.
// Replaces the slow thirtyDayA + thirtyDayB FR-refetch pair.
//
// completionPct = SUM(completed) / SUM(completed + pending + noShow)
//   over all tech_routes rows in the trailing 30-day window (days 1-30 ending at weekEnd).
//
// Requires: `week` endpoint to have run for the last ~5 weeks so tech_routes is populated
// across the 30-day window. As weekly runs accumulate, this becomes fully self-sufficient.
//
// Usage: /api/field-performance/completion?token=critterstop2026&office=DFW&weekEnd=2026-07-10

export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const officeFilter = searchParams.get('office') || 'DFW';
  const weekEndParam = searchParams.get('weekEnd');

  let weekEnd: Date;
  if (weekEndParam) {
    weekEnd = new Date(weekEndParam + 'T00:00:00.000Z');
  } else {
    weekEnd = new Date();
    weekEnd.setHours(0, 0, 0, 0);
    weekEnd.setDate(weekEnd.getDate() - weekEnd.getDay());
  }

  // 30-day window: weekEnd going back 29 days (30 calendar days inclusive)
  const rangeStart = new Date(weekEnd);
  rangeStart.setDate(weekEnd.getDate() - 29);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const log: string[] = [
    `Office: ${officeFilter}`,
    `Completion window: ${fmt(rangeStart)} → ${fmt(weekEnd)} (30 days, from tech_routes DB)`,
  ];

  try {
    // Load PMP techs for this office
    const pmpTechs = await prisma.technician.findMany({
      where: { office: officeFilter, team: 'PMP', status: 'ACTIVE', frEmployeeId: { not: null } },
    });

    if (pmpTechs.length === 0) {
      return NextResponse.json({
        status: 'success', step: 'completion', office: officeFilter,
        weekEnd: fmt(weekEnd), techsUpserted: 0, results: [],
        log: [...log, 'No PMP techs for this office'].join('\n'),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Aggregate completed/pending/noShow per tech over the 30-day window from tech_routes
    const agg = await prisma.$queryRaw<Array<{
      techId: string;
      completed: bigint;
      pending: bigint;
      noshow: bigint;
    }>>`
      SELECT "techId",
             SUM("completed") as completed,
             SUM("pending")   as pending,
             SUM("noShow")    as noshow
      FROM tech_routes
      WHERE "office" = ${officeFilter}
        AND "date" >= ${rangeStart}
        AND "date" <= ${weekEnd}
      GROUP BY "techId"
    `;
    const aggMap = new Map(agg.map(a => [a.techId, a]));

    let upserted = 0;
    const results: any[] = [];

    for (const tech of pmpTechs) {
      const a = aggMap.get(tech.techId);
      const completed = a ? Number(a.completed) : 0;
      const pending   = a ? Number(a.pending)   : 0;
      const noShow    = a ? Number(a.noshow)    : 0;
      const total     = completed + pending + noShow;
      const completionPct = total > 0 ? completed / total : null;

      results.push({
        techId: tech.techId,
        techName: tech.name,
        completionPct: completionPct !== null ? parseFloat((completionPct * 100).toFixed(1)) : null,
        completed, pending, noShow, total,
      });
      log.push(`${tech.name}: ${completionPct !== null ? (completionPct * 100).toFixed(1) + '%' : '—'} (${completed}/${total})`);

      if (completionPct === null) continue;

      const existing = await prisma.techWeek.findUnique({
        where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
      });
      if (existing) {
        await prisma.techWeek.update({
          where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
          data: { completionPct, updatedAt: new Date() },
        });
      } else {
        await prisma.techWeek.create({
          data: {
            id:           crypto.randomUUID(),
            technicianId: tech.id,
            techId:       tech.techId,
            weekEnd,
            office:       officeFilter,
            team:         'PMP',
            siteLeader:   tech.siteLeader,
            crewLeader:   tech.crewLeader,
            completionPct,
            manualAdj:    0,
          },
        });
      }
      upserted++;
    }

    return NextResponse.json({
      status:        'success',
      step:          'completion',
      office:        officeFilter,
      weekEnd:       fmt(weekEnd),
      rangeStart:    fmt(rangeStart),
      rangeEnd:      fmt(weekEnd),
      techsUpserted: upserted,
      results,
      log: log.join('\n'),
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    log.push(`Error: ${e.message}`);
    return NextResponse.json({ status: 'error', error: e.message, log: log.join('\n') }, { status: 500 });
  }
}
