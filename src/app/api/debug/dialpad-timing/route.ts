import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // Marlon: break down his legs by state + span, to see what's marked abandoned and why
  const dist = await prisma.$queryRaw<any[]>`
    SELECT state, COUNT(*) AS n,
      COUNT(*) FILTER (WHERE (date_ended - date_started) < 1000) AS under1s,
      COUNT(*) FILTER (WHERE (date_ended - date_started) >= 1000) AS over1s,
      COUNT(*) FILTER (WHERE date_connected IS NOT NULL) AS connected
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_started >= ${start}
      AND target_name = 'Marlon Marzon'
    GROUP BY state
  `;
  // what the stats function would now return
  const stat = await prisma.$queryRaw<any[]>`SELECT get_agent_stats(${start}, ${Date.now()}) AS s`;
  const agents = stat[0]?.s || [];
  const marlon = (agents as any[]).find((a:any)=>a.name==='Marlon Marzon');
  return NextResponse.json({ marlonStateDistribution: dist.map((r:any)=>({state:r.state, n:Number(r.n), under1s:Number(r.under1s), over1s:Number(r.over1s), connected:Number(r.connected)})), marlonFromStatsFunction: marlon });
}
