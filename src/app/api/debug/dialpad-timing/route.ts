import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // all unconnected legs for the 3 agents, with span, sorted by span — to see the abandoned/missed boundary
  const rows = await prisma.$queryRaw<any[]>`
    SELECT target_name, state, (date_ended - date_started) AS span_ms
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user'
      AND date_connected IS NULL
      AND date_started >= ${start}
      AND target_name IN ('Marlon Marzon','Renea Porter','Lester Bueno')
    ORDER BY target_name, span_ms
  `;
  return NextResponse.json({ rows: rows.map((r:any)=>({ agent:r.target_name, state:r.state, span_ms: r.span_ms!=null?Number(r.span_ms):null, span_s: r.span_ms!=null?(Number(r.span_ms)/1000).toFixed(1):null })) });
}
