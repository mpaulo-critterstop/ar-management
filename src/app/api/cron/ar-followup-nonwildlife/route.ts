// Non-wildlife overdue invoices → Pest AI, routed to a PER-OFFICE webhook.
// Separate from the wildlife ar-followup (which stays on its single webhook). This covers every NON-wildlife
// overdue invoice with a balance, due YESTERDAY (going-forward only — no backlog sweep), fired once daily.
// Same safeguards as wildlife: enroll once (arFollowupSent), paid baseline (arEnrolledPaid), and the
// commercial / parent-child / bill-to exclusion (excludeFromAutomation).
//
//   /api/cron/ar-followup-nonwildlife?token=critterstop2026&dry=true   (preview — sends nothing)
//   /api/cron/ar-followup-nonwildlife?token=critterstop2026            (live)
//   optional: &office=ATX (default: only offices with a configured webhook), &limit=200, &days=1
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// The wildlife service IDs handled by the OTHER endpoint — excluded here so we don't double-send.
const WILDLIFE_SERVICE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];

// Per-office Pest AI webhooks for NON-wildlife overdue. Add offices here as their webhooks are created.
// Only offices present in this map are enrolled (others are skipped until their webhook exists).
const OFFICE_WEBHOOKS: Record<string, string> = {
  ATX: 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/81b4942e-427d-44d9-ab24-68022e64c3d8',
  // DFW: '...',
  // OKC: '...',
  // CStat: '...',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = searchParams.get('dry') === 'true';
  const officeParam = searchParams.get('office') || undefined;
  const limit = parseInt(searchParams.get('limit') || '200');
  const days = parseInt(searchParams.get('days') || '1'); // due within the last N days (default: yesterday)
  const singleInvoiceId = searchParams.get('invoiceId') || undefined; // send one specific invoice (bypasses date window)

  // Only offices with a configured webhook (optionally narrowed to ?office=).
  const activeOffices = Object.keys(OFFICE_WEBHOOKS).filter(o => !officeParam || o === officeParam);
  if (!activeOffices.length) {
    return NextResponse.json({ error: `No configured non-wildlife webhook for office=${officeParam || '(any)'}` }, { status: 400 });
  }

  const wildlistCsv = WILDLIFE_SERVICE_IDS.join(',');
  const officeCsv = activeOffices.map(o => `'${o}'`).join(',');

  // Non-wildlife overdue invoices with a balance, due in the last N days (yesterday), not yet enrolled,
  // customer not excluded, in an office we have a webhook for.
  const invoices = await prisma.$queryRawUnsafe(`
    SELECT i.*,
      c.name as "customerName", c.phone, c.email, c."serviceAddr", c."externalId" as "customerExternalId"
    FROM invoices i
    JOIN customers c ON c.id = i."customerId"
    WHERE i.status = 'OVERDUE'
      AND (i."serviceId" IS NULL OR i."serviceId" NOT IN (${wildlistCsv}))
      AND i.amount > 0
      AND i.paid < i.amount
      AND i."arFollowupSent" = false
      AND c."excludeFromAutomation" = false
      AND i.office IN (${officeCsv})
      ${singleInvoiceId
        ? `AND i."externalId" = '${singleInvoiceId.replace(/'/g, "")}'`
        : `AND i.due >= (CURRENT_DATE - INTERVAL '${days} day') AND i.due < CURRENT_DATE`}
    ORDER BY i.due ASC
    LIMIT ${limit}
  `) as any[];

  const results: any[] = [];
  let sent = 0, failed = 0, skippedNoWebhook = 0;

  for (const inv of invoices) {
    const webhook = OFFICE_WEBHOOKS[inv.office];
    if (!webhook) { skippedNoWebhook++; continue; }

    const nameParts = (inv.customerName || '').trim().split(' ');
    const fname = nameParts[0] || '';
    const lname = nameParts.slice(1).join(' ') || '';
    const amountDue = Number(inv.amount || 0) - Number(inv.paid || 0);

    const payload = {
      fname,
      lname,
      phone1:        (inv.phone || '').replace(/\D/g, ''),
      email:         inv.email || '',
      address:       inv.serviceAddr || '',
      invoiceNumber: inv.externalId || inv.id,
      invoiceAmount: Number(inv.amount || 0).toFixed(2),
      amountDue:     amountDue.toFixed(2),
      dueDate:       inv.due ? new Date(inv.due).toISOString().split('T')[0] : '',
      officeName:    inv.office || '',
      salesRep:      '',
      customerID:    inv.customerExternalId || inv.customerId,
    };

    if (dry) {
      results.push({ office: inv.office, invoiceId: inv.externalId, customer: inv.customerName, serviceId: inv.serviceId, amountDue: amountDue.toFixed(2), dueDate: payload.dueDate, status: 'would_send' });
      continue;
    }

    try {
      const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const resText = await res.text();
      if (res.ok) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { arFollowupSent: true, arFollowupSentAt: new Date(), arEnrolledPaid: Number(inv.paid || 0) },
        });
        results.push({ office: inv.office, invoiceId: inv.externalId, customer: inv.customerName, amountDue: amountDue.toFixed(2), status: 'sent', httpStatus: res.status });
        sent++;
      } else {
        results.push({ office: inv.office, invoiceId: inv.externalId, customer: inv.customerName, status: 'failed', httpStatus: res.status, response: resText.slice(0, 200) });
        failed++;
      }
    } catch (e: any) {
      results.push({ office: inv.office, invoiceId: inv.externalId, customer: inv.customerName, status: 'error', error: e.message });
      failed++;
    }
    await new Promise(r => setTimeout(r, 1000)); // throttle
  }

  return NextResponse.json({ dryRun: dry, offices: activeOffices, total: invoices.length, sent, failed, skippedNoWebhook, results });
}
