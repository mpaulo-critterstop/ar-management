// Sync/cache freshness monitor. Checks the "last updated" timestamp of the caches/syncs that have silently
// frozen before, and pings Slack if any is stale beyond its threshold. Run this daily (early, before the
// reports that depend on these). Catches silent background-job death instead of discovering it days later via
// wrong numbers.
//   /api/cron/sync-health?token=critterstop2026        (checks + alerts if stale)
//   /api/cron/sync-health?token=critterstop2026&dry=1   (returns status JSON, no Slack)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const HOUR = 3600 * 1000;

async function sendSlack(webhook: string, text: string) {
  await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
}

// Each check: a label, how to get its freshest timestamp, and the max age (hours) before it's "stale".
async function checks() {
  const now = Date.now();
  const out: { name: string; lastUpdate: Date | null; ageHours: number | null; thresholdH: number; stale: boolean }[] = [];

  const add = (name: string, lastUpdate: Date | null, thresholdH: number) => {
    const ageHours = lastUpdate ? Math.round((now - lastUpdate.getTime()) / HOUR * 10) / 10 : null;
    out.push({ name, lastUpdate, ageHours, thresholdH, stale: ageHours == null || ageHours > thresholdH });
  };

  // 1) Closeout forms cache (froze twice — the report reads it). Fresh = a form or cache write in ~36h.
  const cf = await prisma.closeoutForm.aggregate({ _max: { updatedAt: true } }).catch(() => null);
  add('closeout_forms cache', cf?._max?.updatedAt ?? null, 36);

  // 2) Pest inspections sync.
  const pi = await prisma.pestInspection.aggregate({ _max: { updatedAt: true } }).catch(() => null);
  add('pest_inspections sync', pi?._max?.updatedAt ?? null, 36);

  // 3) Service pool (job pool) sync.
  const sp = await prisma.$queryRawUnsafe(`SELECT MAX("syncedAt") AS m FROM service_pool`).catch(() => null) as any[];
  add('service_pool sync', sp?.[0]?.m ? new Date(sp[0].m) : null, 36);

  // 4) Main FR sync (invoices) — should be very fresh (runs often).
  const inv = await prisma.invoice.aggregate({ _max: { updatedAt: true } }).catch(() => null);
  add('invoices sync', inv?._max?.updatedAt ?? null, 6);

  return out;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== process.env.CRON_SECRET && sp.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = sp.get('dry') === '1';
  const results = await checks();
  const stale = results.filter(r => r.stale);

  if (dry) return NextResponse.json({ checkedAt: new Date().toISOString(), staleCount: stale.length, results });

  if (stale.length) {
    const webhook = process.env.SLACK_HEALTH_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
    if (webhook) {
      const lines = stale.map(s => `• *${s.name}* — last updated ${s.ageHours != null ? `${s.ageHours}h ago` : 'never / unknown'} (threshold ${s.thresholdH}h)`).join('\n');
      await sendSlack(webhook, `⚠️ *Sync health alert* — ${stale.length} data source(s) stale:\n${lines}\n\nA background sync may have silently stopped. Check the cron + heartbeat.`);
    }
  }
  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString(), staleCount: stale.length, alerted: stale.length > 0, results });
}
