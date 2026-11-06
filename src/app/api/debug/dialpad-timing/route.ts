// TEMP: verify the <1000ms abandoned threshold matches Dialpad per agent.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const TH = Number(req.nextUrl.searchParams.get('th') || 1000);
  const rows = await prisma.$queryRaw<any[]>`
    SELECT target_name,
      COUNT(*) FILTER (WHERE date_connected IS NOT NULL) AS answered,
      COUNT(*) FILTER (WHERE date_connected IS NULL AND (date_ended - date_started) >= ${TH}) AS missed,
      COUNT(*) FILTER (WHERE date_connected IS NULL AND (date_ended - date_started) < ${TH}) AS abandoned
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_started >= ${start}
      AND target_name IN ('Marlon Marzon','Renea Porter','Lester Bueno')
    GROUP BY target_name
  `;
  return NextResponse.json({ thresholdMs: TH, rows: rows.map((r:any)=>({agent:r.target_name, answered:Number(r.answered), missed:Number(r.missed), abandoned:Number(r.abandoned)})) });
}
