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

  for (const row of rows) {
    try {
      const frCustomerId = String(row.fr_id || '').trim();
      const ticketId = String(row.invoice_id || '').trim();
      const pmName = String(row.pm || '').trim() || null;
      const inspectionDate = row.inspection_date ? new Date(row.inspection_date) : null;
      const isSold = String(row.sold || '').toLowerCase() === 'yes';
      const amount = parseFloat(row.amount_booked) || 0;

      if (!frCustomerId) { skipped++; skipReasons.push(`Missing FR ID`); continue; }

      // Find customer by FR ID
      const customer = await prisma.customer.findFirst({
        where: { externalId: frCustomerId, office },
      });
      if (!customer) { 
        skipped++; 
        skipReasons.push(`Customer not found: FR ID ${frCustomerId}`); 
        continue; 
      }

      // Find invoice by ticket ID
      const invoice = await prisma.invoice.findFirst({
        where: { externalId: ticketId, office },
      });

      const status = isSold ? 'SOLD' : 'INSPECTED';

      // Check if lead already exists for this ticket
      const existing = await prisma.lead.findFirst({
        where: { externalId: `csv_${ticketId}` },
      });

      const leadData = {
        office,
        customerId: customer.id,
        pmName,
        inspectionDate,
        status,
        invoiceId: invoice?.id || null,
        amount: isSold ? (invoice ? Number(invoice.amount) : amount) : null,
      };

      if (existing) {
        await prisma.lead.update({
          where: { id: existing.id },
          data: leadData,
        });
        updated++;
      } else {
        await prisma.lead.create({
          data: {
            externalId: `csv_${ticketId}`,
            ...leadData,
          },
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
    skipReasons: skipReasons.slice(0, 20)
  });
}
