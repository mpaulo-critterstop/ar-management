import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // how many calls now have a non-empty categories (proof the stats sync wrote)?
  const cat = await prisma.$queryRaw<any[]>`
    SELECT COUNT(*) FILTER (WHERE categories IS NOT NULL AND categories != '') AS with_cats,
           COUNT(*) AS total
    FROM dialpad_calls WHERE date_started >= ${start}`;
  // per-agent breakdown using the (now categories-driven) state
  const agents = await prisma.$queryRaw<any[]>`
    SELECT target_name,
      COUNT(*) FILTER (WHERE date_connected IS NOT NULL) AS answered,
      COUNT(*) FILTER (WHERE date_connected IS NULL AND state != 'abandoned') AS missed,
      COUNT(*) FILTER (WHERE state = 'abandoned') AS abandoned
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_started >= ${start}
      AND target_name IN ('Marlon Marzon','Renea Porter','Lester Bueno')
    GROUP BY target_name`;
  return NextResponse.json({ withCategories: Number(cat[0].with_cats), total: Number(cat[0].total),
    agents: agents.map((a:any)=>({agent:a.target_name, answered:Number(a.answered), missed:Number(a.missed), abandoned:Number(a.abandoned)})) });
}
