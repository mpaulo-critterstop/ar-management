// Dispatcher TC alert — flags active trapping jobs that have racked up 4+ trap-check (TC) appointments,
// so dispatch can intervene before a job keeps generating endless trap checks.
// Posts to a dedicated Slack webhook (SLACK_TC_WEBHOOK_URL), falling back to SLACK_WEBHOOK_URL.
//   /api/cron/tc-alert?token=critterstop2026        (live: posts to Slack)
//   /api/cron/tc-alert?token=critterstop2026&dry=1  (preview: returns the flagged jobs, posts nothing)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { FR_OFFICES } from '@/lib/helcimBridge';

export const dynamic = 'force-dynamic';

const TC_THRESHOLD = 4;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const NO_REVIEW_FLAG = '69'; // FR genericFlagID "No Review" — Do not send review request (negative experience or 4+ trap checks)

// Write a general "Notes" entry (contactType 0) to a customer in FR.
async function addCustomerNote(auth: string, frCustomerId: string, text: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const qs = `customerID=${frCustomerId}&date=${today}&contactType=0&notes=${encodeURIComponent(text)}&showOnInvoice=0&showTech=0&showCustomer=0`;
  const r = await fetch(`${FR_BASE}/note/create?${auth}&${qs}`, { method: 'POST' }).then(r => r.json()).catch(() => null);
  return !!r?.success;
}

// Add the "No Review" flag to a customer in FR (so Pest AI skips the review request). Idempotent: checks first.
// When the flag is NEWLY added, also drop a general note explaining why.
async function addNoReviewFlag(office: string, frCustomerId: string): Promise<'added' | 'already' | 'skipped' | 'error'> {
  const cfg = (FR_OFFICES as any)[office];
  if (!cfg?.key || !frCustomerId) return 'skipped';
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  try {
    // Search uses entityIDs (PLURAL) — entityID singular is ignored by FR. The genericFlagID filter is also
    // ignored, so resolve the assignments and check for flag 69 client-side.
    const existing = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityIDs=${frCustomerId}&type=CUST`).then(r => r.json()).catch(() => null);
    const exIds = (existing?.genericFlagAssignmentIDs || []).slice(0, 50);
    if (exIds.length) {
      const g = await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=${exIds.join(',')}`).then(r => r.json()).catch(() => null);
      if ((g?.genericFlagAssignments || []).some((a: any) => String(a.genericFlagID) === NO_REVIEW_FLAG)) return 'already';
    }
    const r = await fetch(`${FR_BASE}/genericFlagAssignment/create?${auth}&genericFlagID=${NO_REVIEW_FLAG}&entityID=${frCustomerId}&type=CUST`, { method: 'POST' });
    const j = await r.json().catch(() => null);
    if (!j?.success) return 'error';
    // flag newly added → log a note explaining the reason
    await addCustomerNote(auth, frCustomerId, 'Added No Review flag with reason: 4TCs already and not yet closed out');
    return 'added';
  } catch { return 'error'; }
}

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

  // Add the FR "No Review" flag to each of these customers (4+ TCs = don't ask for a review). Idempotent.
  const flagResults: Record<string, number> = { added: 0, already: 0, skipped: 0, error: 0 };
  for (const j of jobs) {
    const res = await addNoReviewFlag(j.office, String(j.customer?.externalId || ''));
    flagResults[res] = (flagResults[res] || 0) + 1;
  }

  // Mark these jobs alerted so they don't fire again (once-per-job).
  await prisma.dispatchJob.updateMany({ where: { id: { in: jobs.map(j => j.id) } }, data: { tcAlerted: true } });
  return NextResponse.json({ ok: true, flagged: jobs.length, posted: true, noReviewFlags: flagResults });
}
