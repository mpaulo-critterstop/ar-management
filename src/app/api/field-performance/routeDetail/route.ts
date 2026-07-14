// src/app/api/field-performance/routeDetail/route.ts
// Read-only diagnostic: returns per-route production from tech_routes (DB only, no FR calls).
// Usage: /api/field-performance/routeDetail?token=critterstop2026&office=DFW&weekEnd=2026-07-10&tech=Pelaez
//   tech is an optional case-insensitive name filter.

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const office = searchParams.get('office') || undefined;
  const weekEndParam = searchParams.get('weekEnd');
  const techFilter = (searchParams.get('tech') || '').toLowerCase();

  if (!weekEndParam) return NextResponse.json({ error: 'weekEnd required' }, { status: 400 });
  const weekEnd = new Date(weekEndParam + 'T00:00:00.000Z');

  // Pull routes for the week (+ optional office), join tech names
  const rows = await prisma.$queryRaw<Array<{
    techId: string; name: string; office: string; frRouteId: string;
    date: Date; completed: number; pending: number; noShow: number; productionValue: number; hrDays: number | null;
  }>>`
    SELECT r."techId", t.name, r.office, r."frRouteId", r.date,
           r.completed, r.pending, r."noShow", r."productionValue", t."hrDays"
    FROM tech_routes r
    JOIN technicians t ON t."techId" = r."techId"
    WHERE r."weekEnd" = ${weekEnd}
      ${office ? Prisma.sql`AND r.office = ${office}` : Prisma.empty}
    ORDER BY t.name, r.date
  `;

  // Group by tech
  const byTech = new Map<string, any>();
  for (const r of rows) {
    if (techFilter && !r.name.toLowerCase().includes(techFilter)) continue;
    if (!byTech.has(r.techId)) {
      byTech.set(r.techId, {
        techId: r.techId, name: r.name, office: r.office, hrDays: r.hrDays,
        routes: [], totalProduction: 0, productiveDays: 0,
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
    if (r.productionValue > 0) g.productiveDays++;
  }

  const result = [...byTech.values()].map(g => ({
    ...g,
    totalProduction: Math.round(g.totalProduction * 100) / 100,
  }));

  return NextResponse.json({
    weekEnd: weekEnd.toISOString().split('T')[0],
    office: office || 'ALL',
    techCount: result.length,
    techs: result,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
