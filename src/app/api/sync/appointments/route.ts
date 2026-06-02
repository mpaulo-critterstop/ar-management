// src/app/api/sync/appointments/route.ts
// This sync ONLY updates existing leads — never creates duplicates
// CSV import is the source of truth for: inspectionDate, pmName, invoiceId
// FR sync is the source of truth for: amount, status, soldDate

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const OFFICES = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW!, officeId: '1' },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX!, officeId: '5' },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC!, officeId: '3' },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: '4' },
};

const SOLD_SERVICE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];

async function syncLeads(office: string) {
  let updated = 0, errors = 0;

  console.log(`[${office}] Syncing lead amounts and statuses from FR invoices...`);

  // Get all existing leads for this office
  const leads = await prisma.lead.findMany({
    where: { office },
    select: { id: true, invoiceId: true, status: true, amount: true },
  });

  console.log(`[${office}] Total leads to update: ${leads.length}`);

  for (const lead of leads) {
    try {
      if (!lead.invoiceId) continue;

      // Get current invoice data from DB
      const invoice = await prisma.invoice.findUnique({
        where: { id: lead.invoiceId },
        select: { amount: true, status: true, date: true, serviceId: true },
      });

      if (!invoice) continue;

      const isSold = SOLD_SERVICE_IDS.includes(invoice.serviceId || 0) && Number(invoice.amount) > 0;
      const newStatus = isSold ? 'SOLD' : 'INSPECTED';
      const newAmount = Number(invoice.amount);

      // Only update if something changed
      if (lead.status !== newStatus || lead.amount !== newAmount) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: newStatus,
            amount: newAmount,
          },
        });
        updated++;
      }
    } catch (err: any) {
      errors++;
    }
  }

  console.log(`[${office}] Sync complete: ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const officesToSync = body.office ? [body.office] : Object.keys(OFFICES);
  const results: Record<string, any> = {};

  for (const office of officesToSync) {
    const config = OFFICES[office as keyof typeof OFFICES];
    if (!config) continue;
    try {
      results[office] = await syncLeads(office);
    } catch (err: any) {
      results[office] = { error: err.message };
    }
  }

  return NextResponse.json({ success: true, results });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ message: 'Leads sync endpoint ready' });
}
