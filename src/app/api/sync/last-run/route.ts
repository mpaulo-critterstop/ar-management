import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Returns the most recent completed pipeline run per office (from sync_logs `pipeline_<office>`
// rows written by /api/cron/sync). Used by module tables to show a small "last synced" indicator.
// GET /api/sync/last-run?office=DFW  (office optional; omitted returns all)
export async function GET(req: NextRequest) {
  const office = req.nextUrl.searchParams.get('office');

  const sources = office
    ? [`pipeline_${office}`]
    : ['pipeline_DFW', 'pipeline_ATX', 'pipeline_OKC', 'pipeline_CStat', 'pipeline_all'];

  const result: Record<string, { completedAt: string | null; status: string | null }> = {};
  for (const source of sources) {
    const row = await prisma.syncLog.findFirst({
      where: { source, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, status: true },
    });
    const key = source.replace('pipeline_', '');
    result[key] = row ? { completedAt: row.completedAt!.toISOString(), status: row.status } : { completedAt: null, status: null };
  }

  return NextResponse.json(result);
}
