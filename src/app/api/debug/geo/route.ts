import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  try {
    // Geo answered: by target_type, by direction — maybe some answered are outbound or non-user legs not counted
    const byType = await prisma.$queryRaw<any[]>`
      SELECT direction, target_type,
        COUNT(*) FILTER (WHERE date_connected IS NOT NULL)::int AS answered
      FROM dialpad_calls
      WHERE date_started >= ${mStart} AND target_name='Geovany Miranda'
      GROUP BY direction, target_type ORDER BY answered DESC
    `;
    // what get_agent_stats would count (inbound + user)
    const agentStat = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) FILTER (WHERE date_connected IS NOT NULL)::int AS answered_inbound_user
      FROM dialpad_calls WHERE date_started >= ${mStart} AND target_name='Geovany Miranda'
        AND direction='inbound' AND target_type='user'
    `;
    // total connected regardless of filters
    const allConnected = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS n FROM dialpad_calls
      WHERE date_started >= ${mStart} AND target_name='Geovany Miranda' AND date_connected IS NOT NULL
    `;
    return NextResponse.json({ geoAnsweredByType: byType, agentStatCounts: agentStat[0], totalConnectedAnyType: allConnected[0] });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
