import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const office: string = body.office;

  if (!office) return NextResponse.json({ error: 'Office required' }, { status: 400 });

  let created = 0, skipped = 0, errors = 0;

  // Get all SOLD leads that don't have a dispatch job
  const soldLeads = await prisma.lead.findMany({
    where: {
      office,
      status: 'SOLD',
      invoiceId: { not: null },
    },
    select: {
      id: true,
      customerId: true,
      invoiceId: true,
      pmName: true,
    },
  });

  console.log(`[${office}] Found ${soldLeads.length} SOLD leads`);

  for (const lead of soldLeads) {
    try {
      if (!lead.invoiceId) { skipped++; continue; }

      // Check if dispatch job already exists
      const existing = await prisma.dispatchJob.findFirst({
        where: {
          OR: [
            { invoiceId: lead.invoiceId },
            { customerId: lead.customerId, office },
          ],
        },
      });

      if (existing) { skipped++; continue; }

      // Create dispatch job
      await prisma.dispatchJob.create({
        data: {
          office,
          customerId: lead.customerId,
          invoiceId: lead.invoiceId,
          pmName: lead.pmName,
          status: 'ACTIVE',
        },
      });
      created++;
    } catch (err: any) {
      errors++;
      console.error(`Error creating dispatch job for lead ${lead.id}:`, err.message);
    }
  }

  console.log(`[${office}] Init complete: ${created} created, ${skipped} skipped, ${errors} errors`);
  return NextResponse.json({ success: true, created, skipped, errors });
}
