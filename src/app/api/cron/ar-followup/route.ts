// src/app/api/cron/ar-followup/route.ts
// Daily cron: sends overdue wildlife invoices to GHL AR Collections pipeline

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const AR_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/804c863a-a07d-4e18-804d-ab399061cdf9';

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
  const where: any = {
    due: { not: null, lt: now },
    serviceId: { in: WILDLIFE_INVOICE_IDS },
    date: { gte: new Date('2026-01-01T00:00:00.000Z') },
    arFollowupSent: false, // only send to customers not already in sequence
  };
  if (office) where.office = office;
  if (singleInvoiceId) where.externalId = singleInvoiceId;

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true, email: true, serviceAddr: true, externalId: true } },
    },
    orderBy: { due: 'asc' },
    take: limit,
  });


  // Filter where paid < amount (still has balance)
  const overdueInvoices = invoices.filter(inv => Number(inv.paid || 0) < Number(inv.amount || 0));

  const results: any[] = [];
  let sent = 0;
  let failed = 0;

  for (const inv of overdueInvoices) {
    const nameParts = (inv.customer?.name || '').trim().split(' ');
    const fname = nameParts[0] || '';
    const lname = nameParts.slice(1).join(' ') || '';
    const amountDue = Number(inv.amount || 0) - Number(inv.paid || 0);

    const payload = {
      fname,
      lname,
      phone1:        (inv.customer?.phone || '').replace(/\D/g, ''),
      email:         inv.customer?.email || '',
      address:       inv.customer?.serviceAddr || '',
      invoiceNumber: inv.externalId || inv.id,
      invoiceAmount: Number(inv.amount || 0).toFixed(2),
      amountDue:     amountDue.toFixed(2),
      dueDate:       inv.due ? inv.due.toISOString().split('T')[0] : '',
      officeName:    inv.office || '',
      salesRep:      '',
      customerID:    inv.customer?.externalId || inv.id,
    };

    if (dry) {
      results.push({ invoiceId: inv.externalId, customer: inv.customer?.name, amountDue: amountDue.toFixed(2), dueDate: payload.dueDate, status: 'would_send' });
      continue;
    }

    try {
      const res = await fetch(AR_WEBHOOK, {
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
        results.push({ invoiceId: inv.externalId, customer: inv.customer?.name, amountDue: amountDue.toFixed(2), status: 'sent', httpStatus: res.status, response: resText });
        sent++;
      } else {
        results.push({ invoiceId: inv.externalId, customer: inv.customer?.name, amountDue: amountDue.toFixed(2), status: 'failed', httpStatus: res.status, response: resText });
        failed++;
      }
    } catch (e: any) {
      results.push({ invoiceId: inv.externalId, customer: inv.customer?.name, status: 'error', error: e.message });
      failed++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return NextResponse.json({ dryRun: dry, total: overdueInvoices.length, sent, failed, results });
}
