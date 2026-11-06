// TEMP: per-agent call breakdown for a date range, to compare against the Dialpad dashboard.
// GET ?token=critterstop2026&agent=<name>&start=<ms>&end=<ms>   (start/end optional, default this month CST-ish)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const agent = req.nextUrl.searchParams.get('agent');
  // default: start of current month to now (ms epoch)
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const start = Number(req.nextUrl.searchParams.get('start') || monthStart);
  const end = Number(req.nextUrl.searchParams.get('end') || Date.now());

  const where = agent ? prisma.$queryRaw<any[]>`
    SELECT target_name, state,
      COUNT(*) AS n,
      COUNT(*) FILTER (WHERE date_connected IS NOT NULL) AS connected,
      COUNT(*) FILTER (WHERE date_connected IS NULL) AS unconnected
    FROM dialpad_calls
    WHERE direction = 'inbound' AND target_type = 'user'
      AND date_started >= ${start} AND date_started <= ${end}
      AND target_name = ${agent}
    GROUP BY target_name, state ORDER BY state
  ` : prisma.$queryRaw<any[]>`
    SELECT target_name,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE date_connected IS NOT NULL) AS answered,
      COUNT(*) FILTER (WHERE date_connected IS NULL AND state != 'abandoned') AS missed,
      COUNT(*) FILTER (WHERE state = 'abandoned') AS abandoned,
      COUNT(*) FILTER (WHERE state = 'voicemail') AS voicemail
    FROM dialpad_calls
    WHERE direction = 'inbound' AND target_type = 'user'
      AND date_started >= ${start} AND date_started <= ${end}
    GROUP BY target_name ORDER BY total DESC
  `;
  const rows = await where;
  return NextResponse.json({ start, end, startISO: new Date(start).toISOString(), agent: agent || 'ALL', rows: rows.map((r:any)=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k, typeof v==='bigint'?Number(v):v]))) });
}
