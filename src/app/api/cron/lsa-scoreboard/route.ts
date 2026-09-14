// LSA daily follow-up scoreboard → Slack. Two runs a day, for accountability on the "Need Follow-up" list:
//   8am (am): "today's list" — backlog, new in 24h, aging breakdown, oldest untouched. Stores a snapshot.
//   7pm (pm): "end of day score" — worked today (vs the 8am snapshot), still needing follow-up, net change,
//             and new leads today that got no reply.
//
//   /api/cron/lsa-scoreboard?token=critterstop2026&run=am
//   /api/cron/lsa-scoreboard?token=critterstop2026&run=pm
//   /api/cron/lsa-scoreboard?token=critterstop2026&run=am&dry=1   (preview JSON, posts nothing, no snapshot write)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const SNAPSHOT_KEY = 'lsa_scoreboard_am_snapshot';
const DAY = 86400000;

async function sendSlack(webhook: string, text: string, blocks?: any[]) {
  const body: any = { text };
  if (blocks) body.blocks = blocks;
  await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function ageDays(l: any): number {
  const t = (l.lastActivityAt || l.creationDateTime);
  if (!t) return 0;
  return Math.floor((Date.now() - new Date(t).getTime()) / DAY);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = sp.get('token');
  if (token !== process.env.CRON_SECRET && token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const run = sp.get('run') === 'pm' ? 'pm' : 'am';
  const dry = sp.get('dry') === '1';

  // Current "Need Follow-up" leads.
  const needFollowup = await prisma.lsaLead.findMany({
    where: { status: 'Need Follow-up' },
    select: { leadId: true, creationDateTime: true, lastActivityAt: true, outboundCount: true, location: true },
  });
  const total = needFollowup.length;
  const now = Date.now();
  const newIn24h = needFollowup.filter(l => l.creationDateTime && (now - new Date(l.creationDateTime).getTime()) < DAY).length;

  // Aging buckets (by last activity / creation).
  const aging = { '0-3d': 0, '4-7d': 0, '8-14d': 0, '15-30d': 0, '30d+': 0 };
  let oldest = 0;
  for (const l of needFollowup) {
    const d = ageDays(l);
    if (d > oldest) oldest = d;
    if (d <= 3) aging['0-3d']++;
    else if (d <= 7) aging['4-7d']++;
    else if (d <= 14) aging['8-14d']++;
    else if (d <= 30) aging['15-30d']++;
    else aging['30d+']++;
  }

  // Dedicated channel for the daily scoreboard (separate from SLACK_LSA_WEBHOOK_URL, which is the LSA alerts).
  const webhook = process.env.SLACK_LSA_SCOREBOARD_WEBHOOK_URL || process.env.SLACK_LSA_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  const webhookSource = process.env.SLACK_LSA_SCOREBOARD_WEBHOOK_URL ? 'SCOREBOARD' : process.env.SLACK_LSA_WEBHOOK_URL ? 'LSA_ALERTS (fallback)' : process.env.SLACK_WEBHOOK_URL ? 'MAIN (fallback)' : 'NONE';
  if (sp.get('checkWebhook') === '1') return NextResponse.json({ webhookSource, scoreboardVarSet: !!process.env.SLACK_LSA_SCOREBOARD_WEBHOOK_URL });

  // ─── AM: today's list + store snapshot ───────────────────────────────
  if (run === 'am') {
    const snapshot = {
      ts: new Date().toISOString(),
      total,
      leadIds: needFollowup.map(l => l.leadId),
      outbound: Object.fromEntries(needFollowup.map(l => [l.leadId, l.outboundCount])),
    };
    if (!dry) {
      await prisma.appSetting.upsert({
        where: { key: SNAPSHOT_KEY },
        create: { key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) },
        update: { value: JSON.stringify(snapshot) },
      }).catch(() => {});
    }
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: `☀️ LSA Follow-up — Start of Day`, emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*Needs follow-up:*\n${total}` },
        { type: 'mrkdwn', text: `*New (last 24h):*\n${newIn24h}` },
        { type: 'mrkdwn', text: `*Oldest untouched:*\n${oldest} days` },
      ] },
      { type: 'section', text: { type: 'mrkdwn', text: `*Aging:*  0-3d: ${aging['0-3d']}  |  4-7d: ${aging['4-7d']}  |  8-14d: ${aging['8-14d']}  |  15-30d: ${aging['15-30d']}  |  30d+: ${aging['30d+']}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Work the newest first — don't let leads age out. End-of-day score at 7pm.` }] },
    ];
    if (dry) return NextResponse.json({ run, dry, total, newIn24h, oldest, aging });
    if (!webhook) return NextResponse.json({ error: 'No Slack webhook configured' }, { status: 500 });
    await sendSlack(webhook, `LSA Follow-up (AM): ${total} need follow-up, ${newIn24h} new`, blocks);
    return NextResponse.json({ ok: true, run, posted: true, total, newIn24h, oldest, aging });
  }

  // ─── PM: end-of-day score vs the AM snapshot ─────────────────────────
  let worked = 0, netChange = 0, amTotal: number | null = null, snapErr: string | null = null;
  try {
    const snapRow = await prisma.appSetting.findUnique({ where: { key: SNAPSHOT_KEY } });
    if (snapRow) {
      const snap = JSON.parse(snapRow.value);
      amTotal = snap.total;
      const amIds: string[] = snap.leadIds || [];
      const amOutbound: Record<string, number> = snap.outbound || {};
      const stillById = new Map(needFollowup.map(l => [l.leadId, l]));
      // "Worked" = a lead that was in the AM list and either left Need Follow-up OR got a new outbound.
      for (const id of amIds) {
        const still = stillById.get(id);
        if (!still) { worked++; continue; }                       // left the follow-up list
        if ((still.outboundCount || 0) > (amOutbound[id] || 0)) worked++; // got a new outbound reply
      }
      netChange = total - (amTotal ?? total);
    } else {
      snapErr = 'No AM snapshot found — run the 8am scoreboard first for an accurate daily score.';
    }
  } catch (e: any) { snapErr = String(e); }

  // New leads created today that still have zero outbound (slipped same-day).
  const newNoReply = needFollowup.filter(l =>
    l.creationDateTime && (now - new Date(l.creationDateTime).getTime()) < DAY && (l.outboundCount || 0) === 0
  ).length;

  const arrow = netChange < 0 ? '📉' : netChange > 0 ? '📈' : '➡️';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🌙 LSA Follow-up — End of Day Score`, emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Worked today:*\n${worked}` },
      { type: 'mrkdwn', text: `*Still needs follow-up:*\n${total}` },
      { type: 'mrkdwn', text: `*Net change:*\n${arrow} ${amTotal != null ? `${amTotal} → ${total} (${netChange >= 0 ? '+' : ''}${netChange})` : `${total}`}` },
      { type: 'mrkdwn', text: `*New today, no reply:*\n${newNoReply}` },
    ] },
  ];
  if (snapErr) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: snapErr }] } as any);

  if (dry) return NextResponse.json({ run, dry, total, worked, amTotal, netChange, newNoReply, snapErr });
  if (!webhook) return NextResponse.json({ error: 'No Slack webhook configured' }, { status: 500 });
  await sendSlack(webhook, `LSA Follow-up (PM): worked ${worked}, ${total} still open`, blocks);
  return NextResponse.json({ ok: true, run, posted: true, total, worked, amTotal, netChange, newNoReply });
}
