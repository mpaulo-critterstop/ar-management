import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // breakdown of unconnected user-leg calls this month: how classified + how many have empty categories
  const r = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) AS unconnected,
      COUNT(*) FILTER (WHERE state='missed') AS missed,
      COUNT(*) FILTER (WHERE state='abandoned') AS abandoned,
      COUNT(*) FILTER (WHERE state='missed' AND (categories IS NULL OR categories='')) AS missed_no_cats,
      COUNT(*) FILTER (WHERE state='missed' AND (categories IS NULL OR categories='') AND (date_ended-date_started)<1000) AS missed_shouldbe_abandoned,
      MAX(date_started) AS latest_call
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL AND date_started >= ${mStart}
  `;
  // latest call that has categories (proxy for how fresh the stats-sync is)
  const fresh = await prisma.$queryRaw<any[]>`
    SELECT MAX(date_started) AS latest_with_cats FROM dialpad_calls
    WHERE categories IS NOT NULL AND categories != '' AND date_started >= ${mStart}
  `;
  const row = r[0];
  return NextResponse.json({
    unconnected: Number(row.unconnected), missed: Number(row.missed), abandoned: Number(row.abandoned),
    missed_with_empty_categories: Number(row.missed_no_cats),
    missed_that_should_be_abandoned_by_span: Number(row.missed_shouldbe_abandoned),
    latest_unconnected_call_ms: row.latest_call ? Number(row.latest_call) : null,
    latest_call_with_categories_ms: fresh[0].latest_with_cats ? Number(fresh[0].latest_with_cats) : null,
  });
}
