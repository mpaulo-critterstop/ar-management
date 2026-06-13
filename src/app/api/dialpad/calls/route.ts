// src/app/api/dialpad/calls/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function getDateRange(range: string, customStart?: string, customEnd?: string) {
  const now = new Date();
  const cst = (d: Date) => {
    const local = new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    local.setHours(0, 0, 0, 0);
    return Math.floor(local.getTime() / 1000);
  };

  if (range === 'custom' && customStart && customEnd) {
    return {
      start: Math.floor(new Date(customStart).getTime() / 1000),
      end: Math.floor(new Date(customEnd).getTime() / 1000),
    };
  }

  const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  today.setHours(0, 0, 0, 0);

  if (range === 'today') {
    return { start: cst(today), end: Math.floor(Date.now() / 1000) };
  }
  if (range === 'yesterday') {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    const ye = new Date(today); ye.setSeconds(-1);
    return { start: Math.floor(y.getTime() / 1000), end: Math.floor(ye.getTime() / 1000) };
  }
  if (range === 'this_week') {
    const w = new Date(today); w.setDate(w.getDate() - w.getDay());
    return { start: Math.floor(w.getTime() / 1000), end: Math.floor(Date.now() / 1000) };
  }
  if (range === 'last_week') {
    const lw = new Date(today); lw.setDate(lw.getDate() - today.getDay() - 7);
    const lwe = new Date(lw); lwe.setDate(lwe.getDate() + 7);
    return { start: Math.floor(lw.getTime() / 1000), end: Math.floor(lwe.getTime() / 1000) };
  }
  if (range === 'last_7') {
    const s = new Date(today); s.setDate(s.getDate() - 7);
    return { start: Math.floor(s.getTime() / 1000), end: Math.floor(Date.now() / 1000) };
  }
  if (range === 'last_30') {
    const s = new Date(today); s.setDate(s.getDate() - 30);
    return { start: Math.floor(s.getTime() / 1000), end: Math.floor(Date.now() / 1000) };
  }
  if (range === 'last_month') {
    const lm = new Date(today); lm.setDate(1); lm.setMonth(lm.getMonth() - 1);
    const lme = new Date(today); lme.setDate(1); lme.setSeconds(-1);
    return { start: Math.floor(lm.getTime() / 1000), end: Math.floor(lme.getTime() / 1000) };
  }
  // default: current_month
  const m = new Date(today); m.setDate(1);
  return { start: Math.floor(m.getTime() / 1000), end: Math.floor(Date.now() / 1000) };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') || 'current_month';
  const customStart = searchParams.get('start') || undefined;
  const customEnd = searchParams.get('end') || undefined;

  const { start, end } = getDateRange(range, customStart, customEnd);

  const startMs = start * 1000;
  const endMs = end * 1000;

  const [statsRows, agentRows, trackingRows, dailyRows, firstTimeRows] = await Promise.all([
    // Overall stats — deduplicated by master_call_id for unique customer calls
    prisma.$queryRaw<Array<any>>`
      SELECT
        COUNT(DISTINCT CASE WHEN direction = 'inbound' AND master_call_id != '' THEN master_call_id ELSE id::text END) as total,
        COUNT(DISTINCT CASE WHEN direction = 'inbound' AND state = 'answered' AND target_type = 'user' THEN master_call_id END) as answered,
        COUNT(DISTINCT CASE WHEN direction = 'inbound' AND state IN ('missed','voicemail') AND entry_point_call_id != '' THEN entry_point_call_id END) as agent_missed,
        COUNT(DISTINCT CASE WHEN direction = 'inbound' AND state IN ('missed','voicemail') AND (entry_point_call_id = '' OR entry_point_call_id IS NULL) AND (master_call_id = '' OR master_call_id IS NULL) THEN id::text END) as missed_opportunity,
        COUNT(DISTINCT CASE WHEN direction = 'inbound' AND is_first_time = true AND master_call_id != '' THEN master_call_id ELSE CASE WHEN direction = 'inbound' AND is_first_time = true THEN id::text END END) as first_time
      FROM dialpad_calls
      WHERE date_started >= ${startMs} AND date_started <= ${endMs}
    `,
    // Agent stats — only user-type legs (actual agent answered/missed)
    prisma.$queryRaw<Array<any>>`
      SELECT
        target_name as name,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE state = 'answered') as answered,
        COUNT(*) FILTER (WHERE state != 'answered') as missed,
        COALESCE(SUM(duration) FILTER (WHERE state = 'answered'), 0) as total_duration,
        COUNT(*) FILTER (WHERE is_first_time = true) as first_time
      FROM dialpad_calls
      WHERE direction = 'inbound'
        AND target_type = 'user'
        AND date_started >= ${startMs} AND date_started <= ${endMs}
        AND target_name != ''
      GROUP BY target_name
      ORDER BY total DESC
    `,
    // Tracking numbers — deduplicated by master_call_id
    prisma.$queryRaw<Array<any>>`
      SELECT
        tracking_number as number,
        COUNT(DISTINCT CASE WHEN master_call_id != '' THEN master_call_id ELSE id::text END) as count
      FROM dialpad_calls
      WHERE direction = 'inbound'
        AND date_started >= ${startMs} AND date_started <= ${endMs}
        AND tracking_number != ''
      GROUP BY tracking_number
      ORDER BY count DESC
    `,
    // Daily volume — deduplicated by master_call_id
    prisma.$queryRaw<Array<any>>`
      SELECT
        TO_CHAR(TO_TIMESTAMP(date_started / 1000) AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') as date,
        COUNT(DISTINCT CASE WHEN state = 'answered' AND target_type = 'user' THEN master_call_id END) as answered,
        COUNT(DISTINCT CASE WHEN state != 'answered' AND entry_point_call_id != '' THEN entry_point_call_id END) as missed
      FROM dialpad_calls
      WHERE direction = 'inbound'
        AND date_started >= ${startMs} AND date_started <= ${endMs}
      GROUP BY date
      ORDER BY date
    `,
    // First-time by tracking number
    prisma.$queryRaw<Array<any>>`
      SELECT
        tracking_number as number,
        COUNT(DISTINCT CASE WHEN master_call_id != '' THEN master_call_id ELSE id::text END) as total,
        COUNT(DISTINCT CASE WHEN is_first_time = true AND master_call_id != '' THEN master_call_id END) as first_time
      FROM dialpad_calls
      WHERE direction = 'inbound'
        AND date_started >= ${startMs} AND date_started <= ${endMs}
        AND tracking_number != ''
      GROUP BY tracking_number
      ORDER BY total DESC
    `,
  ]);

  const stats = statsRows[0] || {};
  const agentStats = agentRows.map((a: any) => ({
    name: a.name,
    total: Number(a.total),
    answered: Number(a.answered),
    missed: Number(a.missed),
    totalDuration: Number(a.total_duration || 0),
    first_time: Number(a.first_time || 0),
  }));

  const trackingNumbers: Record<string, number> = {};
  trackingRows.forEach((t: any) => { if (t.number) trackingNumbers[t.number] = Number(t.count); });

  const dailyVolume: Record<string, { answered: number; missed: number }> = {};
  dailyRows.forEach((d: any) => { dailyVolume[d.date] = { answered: Number(d.answered), missed: Number(d.missed) }; });

  const firstTimeByTracking: Record<string, { total: number; first_time: number }> = {};
  firstTimeRows.forEach((t: any) => {
    if (t.number) firstTimeByTracking[t.number] = { total: Number(t.total), first_time: Number(t.first_time) };
  });

  return NextResponse.json({
    total: Number(stats.total || 0),
    answered: Number(stats.answered || 0),
    agent_missed: Number(stats.agent_missed || 0),
    missed_opportunity: Number(stats.missed_opportunity || 0),
    first_time: Number(stats.first_time || 0),
    agent_stats: agentStats,
    tracking_numbers: trackingNumbers,
    first_time_by_tracking: firstTimeByTracking,
    daily_volume: dailyVolume,
    range: { start, end },
  });
}
