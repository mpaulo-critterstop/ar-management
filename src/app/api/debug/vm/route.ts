import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  try {
    // Ana Navas: her states + what missed (!= abandoned) counts
    const states = await prisma.$queryRaw<any[]>`
      SELECT state, COUNT(*)::int AS n FROM dialpad_calls
      WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL
        AND date_started >= ${mStart} AND target_name='Ana Navas'
      GROUP BY state`;
    const counts = await prisma.$queryRaw<any[]>`
      SELECT
        COUNT(*) FILTER (WHERE date_connected IS NOT NULL)::int AS answered,
        COUNT(*) FILTER (WHERE date_connected IS NULL AND state != 'abandoned')::int AS missed_current,
        COUNT(*) FILTER (WHERE date_connected IS NULL AND state='voicemail')::int AS voicemail
      FROM dialpad_calls WHERE direction='inbound' AND target_type='user'
        AND date_started >= ${mStart} AND target_name='Ana Navas'`;
    return NextResponse.json({ ana_states: states, ana_counts: counts[0] });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
