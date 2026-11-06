import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // current stored state vs what it SHOULD be at <1000ms
  const rows = await prisma.$queryRaw<any[]>`
    SELECT target_name, state,
      (date_ended - date_started) AS span_ms,
      COUNT(*) AS n
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_started >= ${start}
      AND date_connected IS NULL
      AND target_name IN ('Marlon Marzon','Renea Porter','Lester Bueno')
    GROUP BY target_name, state, (date_ended - date_started)
    ORDER BY target_name, span_ms
  `;
  return NextResponse.json({ rows: rows.map((r:any)=>({agent:r.target_name, state:r.state, span_s:(Number(r.span_ms)/1000).toFixed(1), n:Number(r.n)})) });
}
