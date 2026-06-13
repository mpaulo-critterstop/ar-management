import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') || 'current_month';
  const customStart = searchParams.get('start') || null;
  const customEnd = searchParams.get('end') || null;

  try {
    // Get CST-correct timestamps from Postgres (same as old app)
    const tsRows = await prisma.$queryRaw<Array<{ get_cst_timestamps: any }>>`
      SELECT get_cst_timestamps(${range}, ${customStart}, ${customEnd})
    `;
    const ts = tsRows[0]?.get_cst_timestamps;
    if (!ts) throw new Error('Failed to get timestamps');

    const pStart = BigInt(Math.round(Number(ts.p_start)));
    const pEnd   = BigInt(Math.round(Number(ts.p_end)));

    const [statsRows, agentRows, trackingRows, dailyRows, firstTimeRows] = await Promise.all([
      prisma.$queryRaw<Array<{ get_call_stats: any }>>`SELECT get_call_stats(${pStart}, ${pEnd})`,
      prisma.$queryRaw<Array<{ get_agent_stats: any }>>`SELECT get_agent_stats(${pStart}, ${pEnd})`,
      prisma.$queryRaw<Array<{ get_tracking_stats: any }>>`SELECT get_tracking_stats(${pStart}, ${pEnd})`,
      prisma.$queryRaw<Array<{ get_daily_volume: any }>>`SELECT get_daily_volume(${pStart}, ${pEnd})`,
      prisma.$queryRaw<Array<{ get_firsttime_by_tracking: any }>>`SELECT get_firsttime_by_tracking(${pStart}, ${pEnd})`,
    ]);

    const stats        = statsRows[0]?.get_call_stats || {};
    const agentArray   = agentRows[0]?.get_agent_stats || [];
    const trackingArray= trackingRows[0]?.get_tracking_stats || [];
    const dailyArray   = dailyRows[0]?.get_daily_volume || [];
    const firstTimeArr = firstTimeRows[0]?.get_firsttime_by_tracking || [];

    const agentStats = (agentArray as any[]).map((a: any) => ({
      name: a.name,
      total: Number(a.total),
      answered: Number(a.answered),
      missed: Number(a.missed),
      totalDuration: Number(a.totalDuration || 0),
      first_time: Number(a.first_time || 0),
    }));

    const trackingNumbers: Record<string, number> = {};
    (trackingArray as any[]).forEach((t: any) => { if (t.number) trackingNumbers[t.number] = Number(t.count); });

    const dailyVolume: Record<string, { answered: number; missed: number }> = {};
    (dailyArray as any[]).forEach((d: any) => { dailyVolume[d.date] = { answered: Number(d.answered), missed: Number(d.missed) }; });

    const firstTimeByTracking: Record<string, { total: number; first_time: number }> = {};
    (firstTimeArr as any[]).forEach((t: any) => {
      if (t.number) firstTimeByTracking[t.number] = { total: Number(t.total), first_time: Number(t.first_time) };
    });

    return NextResponse.json({
      total:              Number(stats.total || 0),
      answered:           Number(stats.answered || 0),
      agent_missed:       Number(stats.agent_missed || 0),
      missed_opportunity: Number(stats.missed_opportunity || 0),
      first_time:         Number(stats.first_time || 0),
      agent_stats:        agentStats,
      tracking_numbers:   trackingNumbers,
      first_time_by_tracking: firstTimeByTracking,
      daily_volume:       dailyVolume,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
