// src/app/api/cron/sync/route.ts
// Trigger endpoint for cron-job.org. Returns 200 INSTANTLY so the cron service records
// "Successful 200 OK" without waiting out the multi-minute sync.
//
// STAGE-CHAINED pipeline: each call runs ONE stage, then triggers the NEXT stage as a fresh
// request (via waitUntil). This gives every stage its own full maxDuration budget — critical
// because DFW's AR sync alone can approach 300s, so all 4 stages can't fit in one function.
//   entry (no stage) -> ar -> leads -> csr -> dispatch -> (writes pipeline_<office> log)
//
// Order matters: AR (invoices) before Leads (matches invoice -> SOLD, creates dispatch jobs)
// before CSR (inspection/lead data) before Dispatch (enriches jobs).
//
// Usage (per office): GET /api/cron/sync?office=DFW  with
//   Authorization: Bearer <CRON_SECRET>  OR  ?token=critterstop2026
import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';

// The wrapper returns 200 instantly but keeps running the stage via waitUntil, which is bounded by
// this function's maxDuration. Default 300s killed DFW's AR stage mid-run (no fieldroutes_auto_DFW
// log). Pro allows 800s. Each stage chains as its OWN request, so each gets a fresh 800s budget.
export const maxDuration = 800;

const STAGES = ['ar', 'leads', 'csr', 'dispatch'] as const;
type Stage = typeof STAGES[number];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const token = searchParams.get('token');

  const authed =
    isVercelCron ||
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    token === 'critterstop2026' ||
    token === process.env.CRON_SECRET;
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const office = searchParams.get('office') || '';
  const stageParam = searchParams.get('stage') as Stage | null;
  // Entry point (no stage) starts the chain at 'ar'. A ?stage= runs just that one stage.
  const stage: Stage = stageParam && STAGES.includes(stageParam) ? stageParam : 'ar';
  // 'single=1' runs only this stage without triggering the next (manual single-stage use).
  const single = searchParams.get('single') === '1';

  const baseUrl = process.env.NEXTAUTH_URL;
  const headers = {
    'Content-Type': 'application/json',
    'x-cron-secret': process.env.CRON_SECRET || '',
  };
  // Optional manual date range — lets you re-sync a specific historical date (e.g. ?from=2026-07-27&to=2026-07-27)
  // to catch invoices whose FR dateUpdated is behind the incremental window (paid-but-still-due fixes).
  const fromDate = searchParams.get('from') || undefined;
  const toDate = searchParams.get('to') || undefined;
  const body = JSON.stringify({ office, ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) });
  const startedAt = new Date();

  // Run the current stage's actual work (awaits the underlying sync endpoint).
  const runStage = async () => {
    if (stage === 'ar') {
      await fetch(`${baseUrl}/api/sync/auto`, { method: 'POST', headers, body, signal: AbortSignal.timeout(790000) });
    } else if (stage === 'leads') {
      await fetch(`${baseUrl}/api/sync/appointments`, { method: 'POST', headers, body, signal: AbortSignal.timeout(295000) });
    } else if (stage === 'csr') {
      const offices = office ? [office] : ['DFW', 'ATX', 'OKC', 'CStat'];
      for (const o of offices) {
        await fetch(`${baseUrl}/api/sync/csr-appointments?token=critterstop2026&office=${o}`, { signal: AbortSignal.timeout(295000) }).catch(e => console.error(`[cron/sync] csr-appointments ${o}:`, e));
      }
      let fixUrl: string | null = '/api/sync/csr-wildlife-fix?token=critterstop2026&offset=0';
      let guard = 0;
      while (fixUrl && guard < 200) {
        guard++;
        try {
          const r: Response = await fetch(`${baseUrl}${fixUrl}`, { signal: AbortSignal.timeout(120000) });
          const d: any = await r.json();
          fixUrl = d.hasMore && d.nextUrl ? d.nextUrl : null;
        } catch (e) { console.error('[cron/sync] csr-wildlife-fix:', e); break; }
      }
      await fetch(`${baseUrl}/api/leads/csr-backfill?token=critterstop2026&mode=incremental`, { signal: AbortSignal.timeout(295000) }).catch(e => console.error('[cron/sync] csr-backfill:', e));
    } else if (stage === 'dispatch') {
      await fetch(`${baseUrl}/api/dispatch/sync`, { method: 'POST', headers, body, signal: AbortSignal.timeout(295000) });
    }
  };

  // Trigger the next stage as a fresh request (its own function/maxDuration). Not awaited by the
  // stage; fired at the end so the chain continues even though this function is about to end.
  const triggerNext = () => {
    const idx = STAGES.indexOf(stage);
    const next = STAGES[idx + 1];
    const q = `?office=${office}&token=critterstop2026&stage=${next}`;
    return fetch(`${baseUrl}/api/cron/sync${q}`, { signal: AbortSignal.timeout(10000) }).catch(() => {});
  };

  const work = async () => {
    let ok = true;
    try {
      await runStage();
    } catch (err) {
      ok = false;
      console.error(`[cron/sync] stage ${stage} error for ${office || 'all'}:`, err);
    }
    // Chain to next stage unless this was a single-stage run or the last stage.
    const isLast = STAGES.indexOf(stage) === STAGES.length - 1;
    if (!single && !isLast) {
      await triggerNext();
    }
    // Write the pipeline completion log when the LAST stage finishes (health/last-run signal).
    if (isLast || single) {
      try {
        const { prisma } = await import('@/lib/prisma');
        await prisma.syncLog.create({
          data: {
            source: `pipeline_${office || 'all'}`,
            status: ok ? 'success' : 'error',
            mode: single ? `single:${stage}` : 'full_pipeline',
            startedAt,
            completedAt: new Date(),
          },
        });
      } catch (e) { console.error('[cron/sync] pipeline log write failed:', e); }
    }
  };

  waitUntil(work());

  return NextResponse.json({
    message: `Triggered stage '${stage}' for ${office || 'all offices'}${single ? ' (single)' : ` (chains to ${STAGES.slice(STAGES.indexOf(stage) + 1).join(' -> ') || 'end'})`}`,
  });
}
