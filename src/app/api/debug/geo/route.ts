import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  try {
    // ALL connected calls mentioning Geo, grouped by direction+target_type — to see the 4 that fall outside inbound/user
    const groups = await prisma.$queryRaw<any[]>`
      SELECT direction, target_type, is_transferred,
        COUNT(*) FILTER (WHERE date_connected IS NOT NULL)::int AS answered
      FROM dialpad_calls
      WHERE date_started >= ${mStart} AND target_name='Geovany Miranda'
      GROUP BY direction, target_type, is_transferred ORDER BY answered DESC
    `;
    // specifically: inbound connected calls that are NOT target_type='user' (transfers/other)
    const nonUser = await prisma.$queryRaw<any[]>`
      SELECT id::text, target_type, is_transferred, categories, (duration)::int AS dur
      FROM dialpad_calls
      WHERE date_started >= ${mStart} AND target_name='Geovany Miranda'
        AND direction='inbound' AND date_connected IS NOT NULL AND target_type != 'user'
      LIMIT 20
    `;
    return NextResponse.json({ groups, inbound_connected_nonuser: nonUser });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
