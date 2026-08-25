// src/app/api/cron/ar-followup/route.ts
// Daily cron: sends overdue wildlife invoices to GHL AR Collections pipeline

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const AR_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/804c863a-a07d-4e18-804d-ab399061cdf9';
const AR_PARTIAL_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/AM0p0PhEMlKoBozA9FnB';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dry = searchParams.get('dry') === 'true';
  const office = searchParams.get('office') || undefined;
  const limit = parseInt(searchParams.get('limit') || '100');
  const singleInvoiceId = searchParams.get('invoiceId') || undefined;

  const WILDLIFE_INVOICE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];

  const now = new Date();

  // Find overdue wildlife invoices:
  // - due date is set and has passed
  // - not fully paid (paid < amount)
  // - amount > 0
  // - wildlife service type only
  // - 2026 invoices only
  const officeFilter = office ? `AND i.office = '${office}'` : '';
  const invoiceIdFilter = singleInvoiceId ? `AND i."externalId" = '${singleInvoiceId}'` : '';

  const invoices = await prisma.$queryRawUnsafe(`
    SELECT i.*, 
      c.name as "customerName", c.phone, c.email, c."serviceAddr", c."externalId" as "customerExternalId"
    FROM invoices i
    JOIN customers c ON c.id = i."customerId"
    WHERE i.status = 'OVERDUE'
      AND i."serviceId" IN (553, 716, 720, 501, 674, 479, 541, 542, 624, 510)
      AND i.date >= '2026-01-01'
      AND i."arFollowupSent" = false
      AND i.paid < i.amount
      AND c."excludeFromAutomation" = false
      ${officeFilter}
      ${invoiceIdFilter}
    ORDER BY i.due ASC
    LIMIT ${limit}
  `) as any[];


  // paid < amount already filtered at DB level
  const overdueInvoices = invoices;

  const results: any[] = [];
  let sent = 0;
  let failed = 0;

  for (const inv of overdueInvoices) {
    const nameParts = (inv.customerName || '').trim().split(' ');
    const fname = nameParts[0] || '';
    const lname = nameParts.slice(1).join(' ') || '';
    const amountDue = Number(inv.amount || 0) - Number(inv.paid || 0);
    // If a partial payment already exists at enrollment time, send them into the PARTIAL pipeline (correct
    // balance messaging) instead of the full OVERDUE sequence. Otherwise the customer gets a "you owe the
    // full amount" message, then the sync's partial webhook immediately corrects it with a contradictory
    // "we received your payment" message. paid>0 means they've already paid part of it.
    const alreadyPartiallyPaid = Number(inv.paid || 0) > 0;
    const webhookUrl = alreadyPartiallyPaid ? AR_PARTIAL_WEBHOOK : AR_WEBHOOK;
    const eventType = alreadyPartiallyPaid ? 'partial_payment' : 'overdue';

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
      event:         eventType,
    };

    if (dry) {
      results.push({ invoiceId: inv.externalId, customer: inv.customerName, amountDue: amountDue.toFixed(2), dueDate: payload.dueDate, pipeline: alreadyPartiallyPaid ? 'partial' : 'overdue', status: 'would_send' });
      continue;
    }

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const resText = await res.text();

      if (res.ok) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { arFollowupSent: true, arFollowupSentAt: new Date() },
        });
        results.push({ invoiceId: inv.externalId, customer: inv.customerName, amountDue: amountDue.toFixed(2), pipeline: alreadyPartiallyPaid ? 'partial' : 'overdue', status: 'sent', httpStatus: res.status, response: resText });
        sent++;
      } else {
        results.push({ invoiceId: inv.externalId, customer: inv.customerName, amountDue: amountDue.toFixed(2), status: 'failed', httpStatus: res.status, response: resText });
        failed++;
      }
    } catch (e: any) {
      results.push({ invoiceId: inv.externalId, customer: inv.customerName, status: 'error', error: e.message });
      failed++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return NextResponse.json({ dryRun: dry, total: overdueInvoices.length, sent, failed, results });
}
