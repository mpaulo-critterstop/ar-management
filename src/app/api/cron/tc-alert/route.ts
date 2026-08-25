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
  const office = sp.get('office');

  // Active trapping jobs with 4+ trap checks and not yet completed/closed out.
  const jobs = await prisma.dispatchJob.findMany({
    where: {
      hasTrapping: true,
      trapCheckCount: { gte: TC_THRESHOLD },
      trapsDone: false,
      closedOut: false,
      ...(office ? { office } : {}),
    },
    select: {
      office: true, pmName: true, trapCheckCount: true, lastTrapCheck: true,
      customer: { select: { name: true, externalId: true, serviceAddr: true } },
    },
    orderBy: { trapCheckCount: 'desc' },
  });

  if (dry) {
    return NextResponse.json({
      dry: true, threshold: TC_THRESHOLD, flagged: jobs.length,
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
    return `• *${j.customer?.name || 'Unknown'}* (${j.office}${j.pmName ? ` · ${j.pmName}` : ''}) — *${j.trapCheckCount} trap checks*, last ${last}${j.customer?.externalId ? ` · FR ${j.customer.externalId}` : ''}`;
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
  return NextResponse.json({ ok: true, flagged: jobs.length, posted: true });
}
