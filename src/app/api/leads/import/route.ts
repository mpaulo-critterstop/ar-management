import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const rows: any[] = body.rows;
  const office: string = body.office;

  if (!office) return NextResponse.json({ error: 'Office required' }, { status: 400 });

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const skipReasons: string[] = [];

  // Pre-load all customers and invoices for this office
  const allCustomers = await prisma.customer.findMany({
    where: { office },
    select: { id: true, externalId: true },
  });
  const customerMap = new Map(allCustomers.map((c: any) => [c.externalId, c.id]));

  const allInvoices = await prisma.invoice.findMany({
    where: { office },
    select: { id: true, externalId: true, amount: true, date: true, status: true },
  });
  const invoiceMap = new Map(allInvoices.map((i: any) => [i.externalId, i]));

  for (const row of rows) {
    try {
      const frCustomerId = String(row.fr_id || '').trim();
      const ticketId = String(row.invoice_id || '').trim();
      const pmName = String(row.pm || '').trim() || null;
      const inspectionDate = row.inspection_date ? new Date(row.inspection_date) : null;

      if (!frCustomerId) { skipped++; skipReasons.push(`Missing FR ID`); continue; }

      const customerId = customerMap.get(frCustomerId);
      if (!customerId) {
        skipped++;
        skipReasons.push(`Customer not found: FR ID ${frCustomerId}`);
        continue;
      }

      // Find invoice from DB
      const invoice = ticketId ? invoiceMap.get(ticketId) : null;
      const isSold = invoice && Number(invoice.amount) > 0;
      const status = isSold ? 'SOLD' : 'INSPECTED';
      const amount = invoice ? Number(invoice.amount) : null;
      const soldDate = invoice?.date || null;

      // Unique externalId based on ticket ID
      const externalId = ticketId ? `csv_${ticketId}` : `csv_${frCustomerId}`;

      // Check if lead already exists
      const existing = await prisma.lead.findFirst({
        where: {
          OR: [
            { externalId },
            ...(invoice ? [{ invoiceId: invoice.id }] : []),
          ]
        },
      });

      const leadData = {
        office,
        customerId,
        pmName,
        inspectionDate,  // FROM CSV
        status,
        invoiceId: invoice?.id || null,
        amount,          // FROM FR DB
      };

      if (existing) {
        await prisma.lead.update({
          where: { id: existing.id },
          data: {
            pmName: pmName || existing.pmName,
            inspectionDate: inspectionDate || existing.inspectionDate,
            status,
            amount,
            invoiceId: invoice?.id || existing.invoiceId,
          },
        });
        updated++;
      } else {
        await prisma.lead.create({
          data: { externalId, ...leadData },
        });
        created++;
      }
    } catch (err: any) {
      errors++;
      skipReasons.push(`Error: ${err.message}`);
    }
  }

  return NextResponse.json({
    success: true,
    created,
    updated,
    skipped,
    errors,
    skipReasons: skipReasons.slice(0, 20),
  });
}
