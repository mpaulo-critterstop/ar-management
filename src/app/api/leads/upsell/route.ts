// src/app/api/leads/upsell/route.ts
// Attach a FAR/upsell invoice to an existing SOLD lead for the same customer

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'leads')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const rows: any[] = body.rows;
  const office: string = body.office;

  if (!office) return NextResponse.json({ error: 'Office required' }, { status: 400 });

  let updated = 0, skipped = 0, errors = 0;
  const skipReasons: string[] = [];

  const allInvoices = await prisma.invoice.findMany({
    where: { office },
    select: { id: true, externalId: true, amount: true, date: true },
  });
  const invoiceMap = new Map(allInvoices.map((i: any) => [i.externalId, i]));

  for (const row of rows) {
    try {
      const frCustomerId = String(row.fr_id || '').trim();
      const upsellTicketId = String(row.upsell_invoice_id || '').trim();

      if (!frCustomerId || !upsellTicketId) {
        skipped++;
        skipReasons.push(`Missing fr_id or upsell_invoice_id`);
        continue;
      }

      const customer = await prisma.customer.findFirst({
        where: { externalId: frCustomerId, office },
        select: { id: true },
      });
      if (!customer) {
        skipped++;
        skipReasons.push(`Customer not found: ${frCustomerId}`);
        continue;
      }

      const existingLead = await prisma.lead.findFirst({
        where: { customerId: customer.id, status: 'SOLD' },
        orderBy: { inspectionDate: 'desc' },
      });
      if (!existingLead) {
        skipped++;
        skipReasons.push(`No SOLD lead found for customer ${frCustomerId}`);
        continue;
      }

      const upsellInvoice = invoiceMap.get(upsellTicketId);
      if (!upsellInvoice) {
        skipped++;
        skipReasons.push(`Upsell invoice not found: ${upsellTicketId}`);
        continue;
      }

      await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          upsellInvoiceId: upsellInvoice.id,
          upsellAmount: Number(upsellInvoice.amount),
          upsellDate: upsellInvoice.date,
        },
      });
      updated++;
    } catch (err: any) {
      errors++;
      skipReasons.push(`Error: ${err.message}`);
    }
  }

  return NextResponse.json({ success: true, updated, skipped, errors, skipReasons: skipReasons.slice(0, 20) });
}
