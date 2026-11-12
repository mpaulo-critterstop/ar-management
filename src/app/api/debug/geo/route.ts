import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  try {
    const overall = await prisma.$queryRaw<any[]>`
      SELECT
        COUNT(*) FILTER (WHERE date_connected IS NOT NULL)::int AS answered_legs,
        COUNT(DISTINCT entry_point_call_id) FILTER (WHERE date_connected IS NOT NULL)::int AS answered_unique_epid
      FROM dialpad_calls
      WHERE direction='inbound' AND target_type='user' AND date_started >= ${mStart}
    `;
    const geo = await prisma.$queryRaw<any[]>`
      SELECT
        COUNT(*) FILTER (WHERE date_connected IS NOT NULL)::int AS answered_legs,
        COUNT(DISTINCT entry_point_call_id) FILTER (WHERE date_connected IS NOT NULL)::int AS answered_unique
      FROM dialpad_calls
      WHERE direction='inbound' AND target_type='user' AND date_started >= ${mStart} AND target_name='Geovany Miranda'
    `;
    return NextResponse.json({ overall: overall[0], geo: geo[0] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
