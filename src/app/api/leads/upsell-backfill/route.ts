// src/app/api/leads/upsell-backfill/route.ts
// One-time backfill: finds all FAR invoices in a date range where the customer
// has a SOLD lead but no upsell attached yet, and auto-attaches them.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const FAR_SERVICE_IDS = new Set(['501', '674', '479', '541', '542', '624', '553', '716']);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const from = searchParams.get('from'); // e.g. 2026-06-01
  const to   = searchParams.get('to');   // e.g. 2026-06-30
  const office = searchParams.get('office') || undefined;
  const dryRun = searchParams.get('dry') !== 'false'; // dry run by default

  const where: any = {
    serviceId: { in: [...FAR_SERVICE_IDS].map(Number) },
    amount: { gt: 0 },
  };
  if (office) where.office = office;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to)   where.date.lte = new Date(to + 'T23:59:59Z');
  }

  const farInvoices = await prisma.invoice.findMany({
    where,
    select: { id: true, externalId: true, customerId: true, amount: true, date: true, office: true, serviceId: true },
  });

  const results: any[] = [];

  for (const inv of farInvoices) {
    // Skip if already attached as upsell
    const alreadyUpsell = await prisma.lead.findFirst({
      where: { upsellInvoiceId: inv.id },
    });
    if (alreadyUpsell) {
      results.push({ invoice: inv.externalId, status: 'already_attached', lead: alreadyUpsell.id });
      continue;
    }

    // Find existing SOLD lead for this customer with no upsell yet
    const existingLead = await prisma.lead.findFirst({
      where: { customerId: inv.customerId, status: 'SOLD', upsellInvoiceId: null },
      orderBy: { inspectionDate: 'desc' },
      include: { customer: { select: { name: true } } },
    });

    if (!existingLead) {
      results.push({ invoice: inv.externalId, status: 'no_sold_lead', customerId: inv.customerId });
      continue;
    }

    if (!dryRun) {
      await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          upsellInvoiceId: inv.id,
          upsellAmount: Number(inv.amount),
          upsellDate: inv.date,
        },
      });
    }

    results.push({
      invoice: inv.externalId,
      status: dryRun ? 'would_attach' : 'attached',
      customer: (existingLead as any).customer?.name,
      lead: existingLead.id,
      amount: inv.amount,
      date: inv.date,
    });
  }

  return NextResponse.json({
    dryRun,
    total: farInvoices.length,
    results,
    summary: {
      attached: results.filter(r => r.status === 'attached' || r.status === 'would_attach').length,
      already_attached: results.filter(r => r.status === 'already_attached').length,
      no_sold_lead: results.filter(r => r.status === 'no_sold_lead').length,
    },
  });
}
