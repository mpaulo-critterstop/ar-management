import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const mStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // Geo's unconnected user-leg calls this month — show state, categories, span
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id::text, state, categories,
      (date_ended - date_started) AS span_ms,
      date_started, date_connected
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL
      AND date_started >= ${mStart}
      AND (target_name ILIKE '%miranda%' OR target_name ILIKE '%geo%')
    ORDER BY date_started
  `;
  // also exact target_name match count
  const names = await prisma.$queryRaw<any[]>`
    SELECT DISTINCT target_name FROM dialpad_calls
    WHERE target_name ILIKE '%miranda%' OR target_name ILIKE '%geo%' LIMIT 10`;
  return NextResponse.json({
    names: names.map((n:any)=>n.target_name),
    count: rows.length,
    rows: rows.map((r:any)=>({ state:r.state, cats:(r.categories||'(empty)'), span_s:r.span_ms!=null?(Number(r.span_ms)/1000).toFixed(1):null, started:String(r.date_started) }))
  });
}
