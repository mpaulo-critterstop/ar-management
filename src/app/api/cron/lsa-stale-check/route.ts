// LSA stale-lead check — flips leads with no activity for >= N days (default 2) that are still in an
// open, awaiting-us stage to 'Follow-up Needed', and posts ONE Slack alert per newly-flagged lead
// (staleFlagged dedupes so we don't re-alert). Meant to run daily after lsa-sync.
//
//   /api/cron/lsa-stale-check?token=critterstop2026        (default 2 days)
//   &days=3   &dry=1
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Stages where the ball is on US (so silence = dropped follow-up). Booked/Lost are terminal; Awaiting
// Customer means we're correctly waiting on them, so it does NOT auto-flag.
const OPEN_STAGES = new Set(['New', 'Replied', 'Follow-up Needed']);

async function postSlack(text: string) {
  const url = process.env.SLACK_LSA_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const days = Math.min(Number(sp.get('days')) || 2, 30);
  const dry = sp.get('dry') === '1';
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Candidates: open stage, not already stale-flagged, and last activity (or creation) older than cutoff.
  const candidates = await prisma.lsaLead.findMany({
    where: {
      status: { in: [...OPEN_STAGES] },
      staleFlagged: false,
    },
  });

  const stale = candidates.filter(l => {
    const last = l.lastActivityAt || l.creationDateTime;
    return last != null && last < cutoff;
  });

  const flipped: any[] = [];
  let alerted = 0;
  for (const l of stale) {
    if (!dry) {
      await prisma.lsaLead.update({
        where: { id: l.id },
        data: { status: 'Follow-up Needed', staleFlagged: true },
      });
      const who = l.contactName || l.contactPhone || `Lead ${l.leadId}`;
      const kind = l.leadType === 'MESSAGE' ? '💬 Message' : l.leadType === 'PHONE_CALL' ? '📞 Call' : 'Lead';
      const snippet = l.lastMessageText ? ` — "${l.lastMessageText.slice(0, 80)}"` : '';
      const ok = await postSlack(
        `⚠️ *LSA follow-up needed* (${days}+ days no activity)\n${kind}: *${who}*${snippet}\nStage moved to *Follow-up Needed*. Reply in the LSA app.`
      );
      if (ok) alerted++;
    }
    flipped.push({ leadId: l.leadId, contact: l.contactName || l.contactPhone, leadType: l.leadType, lastActivityAt: l.lastActivityAt });
  }

  return NextResponse.json({
    ok: true, dry, days,
    slackConfigured: !!process.env.SLACK_LSA_WEBHOOK_URL,
    candidates: candidates.length, flagged: flipped.length, alerted, flipped,
  });
}
