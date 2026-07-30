// src/app/api/cron/sync/route.ts
// Trigger endpoint for cron-job.org. Returns 200 INSTANTLY (fire-and-forget) so the cron
// service records "Successful 200 OK" without waiting out the multi-minute sync.
//
// Runs the pipeline in the correct order — AR -> Leads -> Dispatch — by chaining each stage
// to the next ON COMPLETION (each stage is its own request with its own maxDuration budget),
// which also fixes the old race where AR + Leads fired simultaneously and Dispatch was skipped.
//
// Usage (per office): GET /api/cron/sync?office=DFW  with either
//   Authorization: Bearer <CRON_SECRET>   OR   ?token=critterstop2026
import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  const authed =
    isVercelCron ||
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    token === 'critterstop2026' ||
    token === process.env.CRON_SECRET;

  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const office = searchParams.get('office') || '';
  const baseUrl = process.env.NEXTAUTH_URL;
  const headers = {
    'Content-Type': 'application/json',
    'x-cron-secret': process.env.CRON_SECRET || '',
  };
  const body = JSON.stringify({ office });

  // Which stages to run (default: full pipeline). Allows ?stage=ar|leads|dispatch to run just one.
  const stage = searchParams.get('stage');

  const call = (path: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body,
      // @ts-ignore
      signal: AbortSignal.timeout(290000),
    });

  // Full CSR stage — mirrors the Leads Tracker "Sync FR" button exactly:
  //   (a) sync/csr-appointments per office
  //   (b) sync/csr-wildlife-fix — paginated loop fixing wildlife records missing employeeId
  //   (c) leads/csr-backfill?mode=incremental — backfill new CSR records
  const runCsrStage = async () => {
    const offices = office ? [office] : ['DFW', 'ATX', 'OKC', 'CStat'];
    // (a) CSR appointment types per office
    for (const o of offices) {
      await fetch(`${baseUrl}/api/sync/csr-appointments?token=critterstop2026&office=${o}`, {
        method: 'GET', // @ts-ignore
        signal: AbortSignal.timeout(290000),
      }).catch(e => console.error(`[cron/sync] csr-appointments ${o}:`, e));
    }
    // (b) wildlife employeeId fix — follow the pagination until hasMore is false
    let fixUrl: string | null = '/api/sync/csr-wildlife-fix?token=critterstop2026&offset=0';
    let guard = 0;
    while (fixUrl && guard < 200) {
      guard++;
      try {
        const r = await fetch(`${baseUrl}${fixUrl}`, { signal: AbortSignal.timeout(290000) as any });
        const d = await r.json();
        fixUrl = d.hasMore && d.nextUrl ? d.nextUrl : null;
      } catch (e) {
        console.error('[cron/sync] csr-wildlife-fix:', e);
        break;
      }
    }
    // (c) incremental CSR backfill
    await fetch(`${baseUrl}/api/leads/csr-backfill?token=critterstop2026&mode=incremental`, {
      signal: AbortSignal.timeout(290000) as any,
    }).catch(e => console.error('[cron/sync] csr-backfill:', e));
  };

  // Chain in order: AR -> Leads -> CSR(full) -> Dispatch. Each awaits the previous so the invoice
  // exists before Leads matches it, CSR inspection/lead data pulls after, and dispatch jobs exist
  // before Dispatch enriches them. NOT awaited by the handler — it returns immediately below.
  const runPipeline = async () => {
    try {
      if (!stage || stage === 'ar') {
        await call('/api/sync/auto');
      }
      if (!stage || stage === 'leads') {
        await call('/api/sync/appointments');
      }
      if (!stage || stage === 'csr') {
        await runCsrStage();
      }
      if (!stage || stage === 'dispatch') {
        await call('/api/dispatch/sync');
      }
    } catch (err) {
      console.error(`[cron/sync] pipeline error for ${office || 'all'}:`, err);
    }
  };

  // waitUntil keeps the serverless function alive to finish the pipeline AFTER the response is
  // sent — so cron-job.org gets an instant 200 while the AR->Leads->Dispatch chain reliably runs
  // to completion (plain fire-and-forget gets frozen by Vercel after the response; verified).
  waitUntil(runPipeline());

  return NextResponse.json({
    message: `Pipeline triggered for ${office || 'all offices'}${stage ? ` (stage: ${stage})` : ' (AR -> Leads -> CSR -> Dispatch)'}`,
  });
}
