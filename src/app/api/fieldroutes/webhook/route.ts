// FieldRoutes webhook receiver — fires when an exclusion is booked/scheduled in FR.
// Purpose: event-driven replacement for polling. When the PM books an exclusion, FR POSTs here; the Hub then
// matches the appointment's customer to a "Pending scheduling appointment" estimate and runs the booking check.
//
// Config the FR trigger rule's webhook (POST) to: https://hub.critterstop.com/api/fieldroutes/webhook
//
// v1 (this step): receive + log the raw payload so we can see FR's exact fields (customer id / appointment id /
// service type), then ack fast. The matching + booking-check wiring is added next, once we see a real payload.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { waitUntil } from '@vercel/functions';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOG_KEY = 'fr_webhook_events'; // rolling log of recent FR webhook payloads (appSetting)

async function parseBody(req: NextRequest): Promise<any> {
  // FR triggers may POST JSON or form-encoded; handle both.
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) return await req.json();
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const fd = await req.formData(); const o: any = {}; fd.forEach((v, k) => { o[k] = v; }); return o;
    }
    // fallback: try json, then raw text
    const txt = await req.text();
    try { return JSON.parse(txt); } catch { return { _raw: txt }; }
  } catch { return {}; }
}

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { if (!/cookie|authorization/i.test(k)) headers[k] = v; });
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { query[k] = v; });
  const receivedAt = new Date().toISOString();

  // Extract likely identifiers defensively (shape unknown until we see a real FR payload).
  const customerId = body?.customerID || body?.customerId || body?.customer_id || query.customerID || query.customerId || null;
  const appointmentId = body?.appointmentID || body?.appointmentId || body?.appointment_id || query.appointmentID || null;
  const serviceType = body?.type || body?.serviceID || body?.serviceType || null;

  // Store a rolling log (last ~100) so we can inspect the real payload shape.
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: LOG_KEY } });
    const log: any[] = row ? JSON.parse(row.value) : [];
    log.unshift({ receivedAt, customerId, appointmentId, serviceType, query, headers, body });
    await prisma.appSetting.upsert({ where: { key: LOG_KEY }, create: { key: LOG_KEY, value: JSON.stringify(log.slice(0, 100)) }, update: { value: JSON.stringify(log.slice(0, 100)) } });
  } catch (e) { console.error('[fr-webhook] log write failed:', e); }

  // STEP B (next): if customerId matches a "Pending" estimate, run the booking check for it.
  if (customerId) {
    waitUntil((async () => {
      try {
        const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://hub.critterstop.com';
        // Only react if we have a pending estimate for this customer.
        const rec = await prisma.appSetting.findUnique({ where: { key: `excl_estimate:${customerId}` } });
        const off = body?.officeID || query.officeID || '';
        if (rec) await fetch(`${base}/api/exclusion-scheduling/check?token=critterstop2026&frId=${customerId}${off ? '&officeID=' + off : ''}`).catch(() => {});
      } catch (e) { console.error('[fr-webhook] check trigger failed:', e); }
    })());
  }

  return NextResponse.json({ ok: true, received: true, customerId, appointmentId, serviceType });
}

// Inspect recent FR webhook events (to see the real payload shape).
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await prisma.appSetting.findUnique({ where: { key: LOG_KEY } });
  const log: any[] = row ? JSON.parse(row.value) : [];
  return NextResponse.json({ count: log.length, events: req.nextUrl.searchParams.get('full') === '1' ? log : log.slice(0, 10).map(e => ({ receivedAt: e.receivedAt, customerId: e.customerId, appointmentId: e.appointmentId, serviceType: e.serviceType })) });
}
