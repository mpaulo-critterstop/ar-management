// TEMP: inspect timing of recent unconnected (missed/abandoned) calls to verify the ring-time calc.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id::text, state, direction, target_type, target_name,
           date_started, date_connected, date_ended, duration,
           (date_ended - date_started) AS span_raw
    FROM dialpad_calls
    WHERE direction = 'inbound' AND target_type = 'user'
      AND date_connected IS NULL
    ORDER BY date_started DESC
    LIMIT 25
  `;
  // show the span in both ms-interpretation and sec-interpretation
  const out = rows.map(r => ({
    id: r.id, state: r.state, target: r.target_name,
    date_started: String(r.date_started), date_ended: String(r.date_ended),
    span_raw: r.span_raw != null ? String(r.span_raw) : null,
    duration: r.duration,
  }));
  return NextResponse.json({ count: out.length, rows: out });
}
