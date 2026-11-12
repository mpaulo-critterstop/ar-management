import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  try {
    // which agents have voicemail state calls this month?
    const vm = await prisma.$queryRaw<any[]>`
      SELECT target_name, COUNT(*)::int AS voicemails
      FROM dialpad_calls
      WHERE direction='inbound' AND target_type='user' AND state='voicemail'
        AND date_started >= ${mStart}
      GROUP BY target_name ORDER BY voicemails DESC LIMIT 10`;
    // overall state distribution for unconnected inbound user calls
    const dist = await prisma.$queryRaw<any[]>`
      SELECT state, COUNT(*)::int AS n
      FROM dialpad_calls WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL
        AND date_started >= ${mStart}
      GROUP BY state ORDER BY n DESC`;
    return NextResponse.json({ agents_with_voicemail: vm, unconnected_state_distribution: dist });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
