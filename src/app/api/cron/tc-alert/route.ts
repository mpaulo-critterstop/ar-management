// Dispatcher TC alert — flags active trapping jobs that have racked up 4+ trap-check (TC) appointments,
// so dispatch can intervene before a job keeps generating endless trap checks.
// Posts to a dedicated Slack webhook (SLACK_TC_WEBHOOK_URL), falling back to SLACK_WEBHOOK_URL.
//   /api/cron/tc-alert?token=critterstop2026        (live: posts to Slack)
//   /api/cron/tc-alert?token=critterstop2026&dry=1  (preview: returns the flagged jobs, posts nothing)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const TC_THRESHOLD = 4;

async function sendSlack(webhook: string, text: string, blocks?: any[]) {
  const body: any = { text };
  if (blocks) body.blocks = blocks;
  await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = sp.get('token');
  if (token !== process.env.CRON_SECRET && token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = sp.get('dry') === '1';
  // This alert feeds a DFW-only Slack channel. Default to DFW; allow ?office= override, ?office=All for all.
  const officeParam = sp.get('office');
  const office = officeParam ? (officeParam === 'All' ? null : officeParam) : 'DFW';
  // Only recently-active jobs — last trap check within the last 10 days. Long-stale jobs that crossed 4+
  // over 10 days ago are a close-out/cleanup problem, not an active trapping alert.
  const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  // Active trapping jobs newly at 4+ trap checks: not closed out, not already alerted, recently active.
  const jobs = await prisma.dispatchJob.findMany({
    where: {
      hasTrapping: true,
      trapCheckCount: { gte: TC_THRESHOLD },
      trapsDone: false,
      closedOut: false,
      tcAlerted: false,
      lastTrapCheck: { gte: cutoff },
      ...(office ? { office } : {}),
    },
    select: {
      id: true, office: true, pmName: true, trapCheckCount: true, lastTrapCheck: true,
      customer: { select: { name: true, externalId: true, serviceAddr: true } },
    },
    orderBy: { trapCheckCount: 'desc' },
    ...(sp.get('limit') ? { take: Math.max(1, Number(sp.get('limit'))) } : {}),
  });

  if (dry) {
    return NextResponse.json({
      dry: true, threshold: TC_THRESHOLD, note: 'Recently-active (last TC ≤10d) jobs newly at 4+, not yet alerted.',
      flagged: jobs.length,
      jobs: jobs.map(j => ({
        customer: j.customer?.name, frId: j.customer?.externalId, office: j.office,
        pm: j.pmName, trapChecks: j.trapCheckCount,
        lastTrapCheck: j.lastTrapCheck ? new Date(j.lastTrapCheck).toISOString().slice(0, 10) : null,
      })),
    });
  }

  const webhook = process.env.SLACK_TC_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return NextResponse.json({ error: 'No Slack webhook configured (SLACK_TC_WEBHOOK_URL / SLACK_WEBHOOK_URL)' }, { status: 500 });

  if (jobs.length === 0) {
    return NextResponse.json({ ok: true, flagged: 0, posted: false, note: 'No jobs at/over threshold — nothing posted.' });
  }

  const lines = jobs.map(j => {
    const last = j.lastTrapCheck ? new Date(j.lastTrapCheck).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    return `• *${j.customer?.name || 'Unknown'}* (${j.office}) — *${j.trapCheckCount} trap checks*, last visit ${last}${j.customer?.externalId ? ` · FRID ${j.customer.externalId}` : ''}`;
  });

  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `🪤 Trap Check Alert — ${jobs.length} job${jobs.length > 1 ? 's' : ''} at ${TC_THRESHOLD}+ TCs`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `These active trapping jobs have reached *${TC_THRESHOLD}+ trap-check appointments* and aren't closed out yet. Please review — they may need intervention or wrap-up.` } },
    { type: 'divider' },
  ];
  // Slack section text caps ~3000 chars; chunk the lines.
  for (let i = 0; i < lines.length; i += 15) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.slice(i, i + 15).join('\n') } });
  }

  await sendSlack(webhook, `Trap Check Alert: ${jobs.length} job(s) at ${TC_THRESHOLD}+ TCs`, blocks);
  // Mark these jobs alerted so they don't fire again (once-per-job).
  await prisma.dispatchJob.updateMany({ where: { id: { in: jobs.map(j => j.id) } }, data: { tcAlerted: true } });
  return NextResponse.json({ ok: true, flagged: jobs.length, posted: true });
}
