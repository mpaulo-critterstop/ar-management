import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Backfill estimate records for exclusion proposals accepted while the SmarterLaunch API was down/exhausted.
// Reads the SL webhook event log, finds accepted exclusions whose stored estimate is MISSING or has an error,
// and re-runs the estimator for each — THROTTLED + HARD-CAPPED so it can never drain the SL daily limit again.
//
// SAFETY:
//   - dry=1 (default): lists what WOULD be re-processed, makes ZERO SL calls.
//   - confirm=1: actually re-runs the estimator. Respects:
//       &max=N        hard cap on SL calls this run (default 10)
//       &delayMs=N    delay between SL calls (default 2000ms)
//   Always run small batches and watch SL usage so the Estimator stays usable for the team.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('confirm') !== '1';
  const max = Math.min(parseInt(sp.get('max') || '10', 10) || 10, 50);
  const delayMs = Math.max(parseInt(sp.get('delayMs') || '2000', 10) || 2000, 500);
  const sinceDays = Math.min(parseInt(sp.get('days') || '3', 10) || 3, 14);
  const sinceMs = Date.now() - sinceDays * 86400000;

  // 1) read the webhook event log
  const logRow = await prisma.appSetting.findUnique({ where: { key: 'sl_webhook_events' } });
  const log: any[] = logRow ? JSON.parse(logRow.value) : [];

  // 2) accepted exclusion events within the window, newest-first, dedup by customerUuid (latest wins)
  const seen = new Set<string>();
  const candidates: any[] = [];
  for (const ev of log) {
    const t = ev.receivedAt ? new Date(ev.receivedAt).getTime() : 0;
    if (t < sinceMs) continue;
    const title = String(ev.raw?.proposal?.title || ev.raw?.proposal?.proposal_template?.title || '');
    const isExclusion = /Permanent Rodent Solution/i.test(title);
    if (!isExclusion || !ev.customerUuid) continue;
    if (seen.has(ev.customerUuid)) continue;
    seen.add(ev.customerUuid);
    candidates.push({ customerUuid: ev.customerUuid, receivedAt: ev.receivedAt, title });
  }

  // 3) which candidates have a MISSING or ERRORED estimate record?
  const estRows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
  const estByUuid: Record<string, any> = {};
  for (const r of estRows) { try { const rec = JSON.parse(r.value); if (rec.customerUuid) estByUuid[rec.customerUuid] = rec; } catch {} }

  const needsBackfill = candidates.filter(c => {
    const rec = estByUuid[c.customerUuid];
    if (!rec) return true;                        // no estimate at all
    if (rec.estimate?.error) return true;         // estimator errored (SL was down)
    if (!rec.estimate?.totalHours && rec.estimate?.totalHours !== 0) return true; // empty/invalid
    return false;
  });

  if (dry) {
    return NextResponse.json({
      dry: true, windowDays: sinceDays,
      acceptedExclusionsInLog: candidates.length,
      needBackfill: needsBackfill.length,
      note: `add &confirm=1 to re-run the estimator (throttled). Will cap at &max=${max} SL calls, ${delayMs}ms apart.`,
      sample: needsBackfill.slice(0, 25).map(c => ({ customerUuid: c.customerUuid, acceptedAt: c.receivedAt })),
    });
  }

  // 4) re-run the estimator, throttled + capped
  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://hub.critterstop.com';
  const results: any[] = [];
  let slCalls = 0;
  for (const c of needsBackfill) {
    if (slCalls >= max) { results.push({ customerUuid: c.customerUuid, status: 'skipped — hit max cap' }); continue; }
    slCalls++;
    const est = await fetch(`${base}/api/exclusion-estimator?token=critterstop2026&customer_uuid=${c.customerUuid}`).then(r => r.json()).catch(e => ({ error: String(e) }));
    if (est?.error) {
      results.push({ customerUuid: c.customerUuid, status: 'estimator error', error: est.error });
    } else {
      // store/refresh the estimate record keyed by FR id (preferred) else uuid
      const frId = est.frCustomerId || c.customerUuid;
      const key = `excl_estimate:${frId}`;
      const existing = estByUuid[c.customerUuid] || {};
      const rec = {
        ...existing,
        proposalUuid: existing.proposalUuid || null,
        customerUuid: c.customerUuid,
        frCustomerId: est.frCustomerId || existing.frCustomerId || null,
        pm: existing.pm || null,
        title: c.title,
        acceptedAt: existing.acceptedAt || c.receivedAt,
        estimate: est,
        status: 'ESTIMATED',
        schedulingNote: existing.schedulingNote || 'Pending scheduling appointment',
        computedAt: new Date().toISOString(),
        backfilledAt: new Date().toISOString(),
      };
      await prisma.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(rec) }, update: { value: JSON.stringify(rec) } });
      results.push({ customerUuid: c.customerUuid, frId: est.frCustomerId, status: 'backfilled', totalHours: est.totalHours, guarantee: est.guaranteeGroup });
    }
    if (slCalls < max) await new Promise(r => setTimeout(r, delayMs));
  }

  return NextResponse.json({ dry: false, slCallsMade: slCalls, cap: max, backfilled: results.filter(r => r.status === 'backfilled').length, remaining: needsBackfill.length - slCalls, results });
}
