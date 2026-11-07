import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // Lester's unconnected (missed/abandoned) legs this month with categories + ring span
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, state, categories,
      (date_ended - date_started) AS span_ms,
      entry_point_call_id AS epid
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL
      AND date_started >= ${start} AND target_name = 'Lester Bueno'
    ORDER BY date_started`;
  return NextResponse.json({ count: rows.length, legs: rows.map((r:any)=>({state:r.state, cats:(r.categories||'(empty)'), span_s:r.span_ms!=null?(Number(r.span_ms)/1000).toFixed(1):null, epid:String(r.epid).slice(0,12)})) });
}
