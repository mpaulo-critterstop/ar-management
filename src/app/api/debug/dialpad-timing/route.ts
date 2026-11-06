import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const agent = req.nextUrl.searchParams.get('agent') || 'Marlon Marzon';
  // Per unique call (entry_point_call_id): did the agent ever connect? what's the MAX leg span (overall ring)?
  const rows = await prisma.$queryRaw<any[]>`
    SELECT entry_point_call_id::text AS epid,
      BOOL_OR(date_connected IS NOT NULL) AS answered,
      MAX(date_ended - date_started) AS max_span_ms,
      COUNT(*) AS legs
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user'
      AND date_started >= ${start}
      AND target_name = ${agent}
      AND entry_point_call_id IS NOT NULL AND entry_point_call_id != ''
    GROUP BY entry_point_call_id
  `;
  let answered=0, missed=0, abandoned=0;
  for(const r of rows){
    if(r.answered) answered++;
    else if(Number(r.max_span_ms) < 10000) abandoned++;
    else missed++;
  }
  return NextResponse.json({ agent, uniqueCalls: rows.length, answered, missed_byCall: missed, abandoned_byCall: abandoned,
    detail: rows.map((r:any)=>({answered:r.answered, maxSpan_s:(Number(r.max_span_ms)/1000).toFixed(1), legs:Number(r.legs)})).filter((x:any)=>!x.answered) });
}
