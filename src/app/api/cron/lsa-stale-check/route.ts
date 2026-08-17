// LSA stale alerts — the SYNC now derives the stage automatically (Awaiting Customer -> Need Follow-up
// after 1 day silent). This job's remaining role: send ONE Slack alert per lead that has entered
// 'Need Follow-up' and hasn't been alerted yet (staleFlagged dedupes). Run daily AFTER lsa-sync.
//
//   /api/cron/lsa-stale-check?token=critterstop2026        &dry=1
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { waitUntil } from '@vercel/functions';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function postSlack(text: string) {
  const url = process.env.SLACK_LSA_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const seed = sp.get('seed') === '1';

  // ?seed=1 → ONE-TIME: mark all current 'Need Follow-up' leads as already-alerted WITHOUT sending any
  // Slack messages. Run this once before enabling the live job so the historical backlog (395 leads)
  // doesn't flood Slack. After seeding, only leads that NEWLY go stale will alert.
  if (seed) {
    const res = await prisma.lsaLead.updateMany({
      where: { status: 'Need Follow-up', staleFlagged: false },
      data: { staleFlagged: true },
    });
    return NextResponse.json({ ok: true, seeded: res.count, note: 'Backlog marked as alerted silently. Future newly-stale leads will alert normally.' });
  }

  // Dry run stays inline so you can see the count. Live run is fire-and-forget (waitUntil keeps it alive).
  if (dry) {
    const result = await runStaleCheck(true);
    return NextResponse.json(result);
  }
  waitUntil(runStaleCheck(false).catch(e => { console.error('lsa-stale-check background error:', e); }));
  return NextResponse.json({ ok: true, started: true, note: 'Stale check running in background. Use ?dry=1 for an inline preview.' });
}

async function runStaleCheck(dry: boolean) {
  // Leads the sync has placed in 'Need Follow-up' that we haven't alerted on yet.
  const toAlert = await prisma.lsaLead.findMany({
    where: { status: 'Need Follow-up', staleFlagged: false },
    orderBy: { lastActivityAt: 'asc' },
  });

  let alerted = 0;
  const alerts: any[] = [];
  for (const l of toAlert) {
    const who = l.contactName || l.contactPhone || `Lead ${l.leadId}`;
    const kind = l.leadType === 'MESSAGE' ? '💬 Message' : l.leadType === 'PHONE_CALL' ? '📞 Call' : 'Lead';
    const snippet = l.lastMessageText ? ` — "${l.lastMessageText.slice(0, 80)}"` : '';
    if (!dry) {
      const ok = await postSlack(
        `⚠️ *LSA follow-up needed* — no customer reply in 1+ day [${l.location}]\n${kind}: *${who}*${snippet}\nReply in the LSA app to move this forward.`
      );
      if (ok) { await prisma.lsaLead.update({ where: { id: l.id }, data: { staleFlagged: true } }); alerted++; }
    }
    alerts.push({ leadId: l.leadId, contact: who, leadType: l.leadType, lastActivityAt: l.lastActivityAt });
  }

  return {
    ok: true, dry,
    slackConfigured: !!process.env.SLACK_LSA_WEBHOOK_URL,
    needFollowup: toAlert.length, alerted, alerts,
  };
}
