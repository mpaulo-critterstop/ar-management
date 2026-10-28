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
import { waitUntil } from '@vercel/functions';
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

  // STEP 2: run the estimator for this accepted proposal, in the background (ack fast below).
  // Only Permanent Rodent Solution templates reach here (SmarterLaunch automation already filters to the 3),
  // but we double-check the title defensively.
  const title = String(body?.proposal?.title || body?.proposal?.proposal_template?.title || '');
  const isExclusion = /Permanent Rodent Solution/i.test(title);
  const frCustomerId = body?.customer?.integrations?.pest_routes?.identifier || null;

  // Exclusion revenue = sum of the Exclusion section's line items (initial_billing_amount, pre-tax, non-taxable),
  // from the webhook payload itself. Excludes Trapping/Fogging/Insulation/Full Attic Restoration/Service Agreement
  // sections — only the "Exclusion" plan's items (roof returns, pipe stacks, fascia, etc.).
  const exclusionRevenue = (() => {
    const plans = body?.proposal?.service_plans || [];
    const exclPlan = plans.find((p: any) => String(p.name || '').trim().toLowerCase() === 'exclusion');
    if (!exclPlan) return null;
    const groups = exclPlan.pricing_groups || [];
    const sum = groups.filter((g: any) => g.selected !== false).reduce((s: number, g: any) => s + (parseFloat(g.initial_billing_amount) || 0), 0);
    return Math.round(sum * 100) / 100;
  })();

  if (isExclusion && customerUuid) {
    waitUntil((async () => {
      try {
        const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://hub.critterstop.com';
        // Call the estimator (it pulls quantities + story/difficulty tags from SmarterLaunch and computes).
        const est = await fetch(`${base}/api/exclusion-estimator?token=critterstop2026&customer_uuid=${customerUuid}`).then(r => r.json()).catch(e => ({ error: String(e) }));
        // Store the estimate keyed by CUSTOMER (FR id preferred, else customer uuid), so a new/updated accepted
        // proposal for the same customer REPLACES the old one — one active exclusion job per customer, latest wins.
        const resolvedFrEarly = (est && est.frCustomerId) || frCustomerId || customerUuid;
        const recKey = `excl_estimate:${resolvedFrEarly}`;
        // Prefer the FR id resolved by the estimator (from the proposal) over the webhook's, then store.
        const resolvedFr = (est && est.frCustomerId) || frCustomerId;
        await prisma.appSetting.upsert({
          where: { key: recKey },
          create: { key: recKey, value: JSON.stringify({ proposalUuid, customerUuid, frCustomerId: resolvedFr, title, acceptedAt: receivedAt, estimate: est, exclusionRevenue, status: 'ESTIMATED', schedulingNote: 'Pending scheduling appointment', computedAt: new Date().toISOString() }) },
          update: { value: JSON.stringify({ proposalUuid, customerUuid, frCustomerId: resolvedFr, title, acceptedAt: receivedAt, estimate: est, exclusionRevenue, status: 'ESTIMATED', schedulingNote: 'Pending scheduling appointment', computedAt: new Date().toISOString() }) },
        });
        // Step 3: immediately check whether the PM has booked it in FR (usually "pending" right after acceptance).
        if (resolvedFr) await fetch(`${base}/api/exclusion-scheduling/check?token=critterstop2026&frId=${resolvedFr}`).catch(() => {});
      } catch (e) { console.error('[sl-webhook] estimator step failed:', e); }
    })());
  }

  // Acknowledge immediately (webhooks must return fast; estimator runs in background).
  return NextResponse.json({ ok: true, received: true, event, proposalUuid, customerUuid, frCustomerId, willEstimate: isExclusion });
}

// GET: inspect recent webhook events (to see the real payload shape once SL starts sending).
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await prisma.appSetting.findUnique({ where: { key: LOG_KEY } });
  const log: any[] = row ? JSON.parse(row.value) : [];
  return NextResponse.json({ count: log.length, events: req.nextUrl.searchParams.get('full') === '1' ? log : log.slice(0, 10).map(e => ({ receivedAt: e.receivedAt, event: e.event, proposalUuid: e.proposalUuid, customerUuid: e.customerUuid, status: e.status })) });
}
