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

  // Pre-load all customers and invoices for this office in one query
  const allCustomers = await prisma.customer.findMany({
    where: { office },
    select: { id: true, externalId: true },
  });
  const customerMap = new Map(allCustomers.map((c: any) => [c.externalId, c.id]));

  const allInvoices = await prisma.invoice.findMany({
    where: { office },
    select: { id: true, externalId: true, amount: true, date: true },
  });
  const invoiceMap = new Map(allInvoices.map((i: any) => [i.externalId, i]));

  // Pre-load existing leads
  const existingLeads = await prisma.lead.findMany({
    where: { office },
    select: { id: true, externalId: true },
  });
  const existingMap = new Map(existingLeads.map((l: any) => [l.externalId, l.id]));

  const toCreate: any[] = [];
  const toUpdate: any[] = [];

  for (const row of rows) {
    try {
      const frCustomerId = String(row.fr_id || '').trim();
      const ticketId = String(row.invoice_id || '').trim();
      const pmName = String(row.pm || '').trim() || null;
      const inspectionDate = row.inspection_date ? new Date(row.inspection_date) : null;
      const isSold = String(row.sold || '').toLowerCase() === 'yes';
      const amount = parseFloat(row.amount_booked) || 0;

      if (!frCustomerId) { skipped++; skipReasons.push(`Missing FR ID`); continue; }

      const customerId = customerMap.get(frCustomerId);
      if (!customerId) {
        skipped++;
        skipReasons.push(`Customer not found: FR ID ${frCustomerId}`);
        continue;
      }

      const invoice = ticketId ? invoiceMap.get(ticketId) : null;
      const status = isSold ? 'SOLD' : 'INSPECTED';
      const externalId = ticketId ? `csv_${ticketId}` : `csv_${frCustomerId}_${inspectionDate?.toISOString().split('T')[0]}`;

      const leadData = {
        office,
        customerId,
        pmName,
        inspectionDate,
        status,
        invoiceId: invoice?.id || null,
        amount: isSold ? (invoice ? Number(invoice.amount) : amount) : null,
      };

      const existingId = existingMap.get(externalId);
      if (existingId) {
        toUpdate.push({ id: existingId, data: leadData });
      } else {
        toCreate.push({ externalId, ...leadData });
      }
    } catch (err: any) {
      errors++;
      skipReasons.push(`Error: ${err.message}`);
    }
  }

  // Batch create
  if (toCreate.length > 0) {
    await prisma.lead.createMany({ data: toCreate, skipDuplicates: true });
    created = toCreate.length;
  }

  // Batch update
  for (const { id, data } of toUpdate) {
    await prisma.lead.update({ where: { id }, data });
    updated++;
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
