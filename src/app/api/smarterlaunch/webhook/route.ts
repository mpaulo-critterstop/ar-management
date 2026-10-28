// SmarterLaunch webhook receiver.
// SmarterLaunch POSTs here when a proposal is accepted. This endpoint (v1, step 1 of the flow):
//   1. receives + validates the event
//   2. extracts the proposal/customer identifiers
//   3. stores the raw event (appSetting JSON log, keyed by proposal uuid)
//   4. acknowledges fast (webhooks must return quickly)
// Steps 2-5 (run estimator, check FR booking, compute status) will be triggered from here next.
//
// Config the webhook URL in SmarterLaunch to: https://hub.critterstop.com/api/smarterlaunch/webhook
// Optional shared secret: set SMARTERLAUNCH_WEBHOOK_SECRET in env; SmarterLaunch sends it (header or body) to auth.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOG_KEY = 'sl_webhook_events'; // rolling JSON log of recent events (appSetting)

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* some webhooks send form/empty */ }

  // Optional auth: if a secret is configured, require it (header or body). If not set, accept (SL may not sign).
  const secret = process.env.SMARTERLAUNCH_WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers.get('x-smarterlaunch-signature') || req.headers.get('authorization') || body?.secret || '';
    if (got !== secret && got !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Extract identifiers defensively — we don't know SL's exact payload shape yet, so capture broadly.
  const event = body?.event || body?.type || body?.event_type || 'unknown';
  const proposalUuid = body?.proposal_uuid || body?.proposal?.uuid || body?.uuid || body?.data?.proposal_uuid || body?.data?.uuid || null;
  const customerUuid = body?.customer_uuid || body?.customer?.uuid || body?.data?.customer_uuid || null;
  const status = body?.status || body?.proposal?.status || body?.data?.status || null;
  const receivedAt = new Date().toISOString();

  // Store a rolling log (last ~100 events) so we can inspect payload shapes + debug.
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: LOG_KEY } });
    const log: any[] = row ? JSON.parse(row.value) : [];
    log.unshift({ receivedAt, event, proposalUuid, customerUuid, status, raw: body });
    const trimmed = log.slice(0, 100);
    await prisma.appSetting.upsert({ where: { key: LOG_KEY }, create: { key: LOG_KEY, value: JSON.stringify(trimmed) }, update: { value: JSON.stringify(trimmed) } });
  } catch (e) {
    console.error('[sl-webhook] log write failed:', e);
  }

  // Acknowledge immediately. (Processing — estimator + FR check — will be added as the next step.)
  return NextResponse.json({ ok: true, received: true, event, proposalUuid, customerUuid });
}

// GET: inspect recent webhook events (to see the real payload shape once SL starts sending).
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await prisma.appSetting.findUnique({ where: { key: LOG_KEY } });
  const log: any[] = row ? JSON.parse(row.value) : [];
  return NextResponse.json({ count: log.length, events: req.nextUrl.searchParams.get('full') === '1' ? log : log.slice(0, 10).map(e => ({ receivedAt: e.receivedAt, event: e.event, proposalUuid: e.proposalUuid, customerUuid: e.customerUuid, status: e.status })) });
}
