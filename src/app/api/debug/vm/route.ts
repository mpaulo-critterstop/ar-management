import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  try {
    // breakdown of Marlon's unconnected calls by state
    const r = await prisma.$queryRaw<any[]>`
      SELECT state, COUNT(*)::int AS n
      FROM dialpad_calls
      WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL
        AND date_started >= ${mStart} AND target_name='Marlon Marzon'
      GROUP BY state ORDER BY n DESC`;
    // what get_agent_stats counts as missed for Marlon
    const missedCount = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) FILTER (WHERE date_connected IS NULL AND state != 'abandoned')::int AS missed,
             COUNT(*) FILTER (WHERE state='voicemail')::int AS voicemail
      FROM dialpad_calls WHERE direction='inbound' AND target_type='user'
        AND date_started >= ${mStart} AND target_name='Marlon Marzon'`;
    return NextResponse.json({ marlon_unconnected_by_state: r, marlon_counts: missedCount[0] });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
