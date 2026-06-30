// src/app/api/cron/pestai-followup/route.ts
// Daily cron: pushes unsold leads (INSPECTED, 5+ days old) to PestAI via GoHighLevel webhook

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const PESTAI_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/fb21a8d2-23eb-4bb4-b904-9a10f3194b93';
const DAYS_THRESHOLD = 5;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const office = searchParams.get('office') || undefined;
  const dryRun = searchParams.get('dry') === 'true';
  const limit  = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
  const maxDays = searchParams.get('maxDays') ? parseInt(searchParams.get('maxDays')!) : 60;

  // Find INSPECTED leads older than 5 days that haven't been sent yet
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_THRESHOLD);

  const maxCutoff = new Date();
  maxCutoff.setDate(maxCutoff.getDate() - maxDays);

  const leads = await prisma.lead.findMany({
    where: {
      status: 'INSPECTED',
      followUpSent: false,
      inspectionDate: { lte: cutoff, gte: maxCutoff },
      ...(office ? { office } : {}),
    },
    include: {
      customer: { select: { name: true, phone: true, email: true, serviceAddr: true } },
    },
    orderBy: { inspectionDate: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  const results: any[] = [];
  let sent = 0, failed = 0;

  for (const lead of leads) {
    const daysSince = Math.floor((Date.now() - new Date(lead.inspectionDate!).getTime()) / 86400000);

    const nameParts = (lead.customer?.name || '').trim().split(' ');
    const fname = nameParts[0] || '';
    const lname = nameParts.slice(1).join(' ') || '';

    const payload = {
      fname,
      lname,
      phone1:      (lead.customer?.phone || '').replace(/\D/g, ''),
      email:       lead.customer?.email || '',
      address:     lead.customer?.serviceAddr || '',
      serviceDate: lead.inspectionDate ? lead.inspectionDate.toISOString().split('T')[0] : '',
      techName:    lead.pmName || '',
      officeName:  lead.office || '',
      description: `Unsold lead — inspected ${daysSince} days ago`,
      customerID:  lead.id,
      salesRep:    lead.pmName || '',
    };

    if (dryRun) {
      results.push({ leadId: lead.id, customer: lead.customer?.name, status: 'would_send', payload });
      continue;
    }

    try {
      const res = await fetch(PESTAI_WEBHOOK, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { followUpSent: true, followUpSentAt: new Date() },
        });
        results.push({ leadId: lead.id, customer: lead.customer?.name, status: 'sent' });
        sent++;
      } else {
        results.push({ leadId: lead.id, customer: lead.customer?.name, status: 'failed', error: res.status });
        failed++;
      }
    } catch (err: any) {
      results.push({ leadId: lead.id, customer: lead.customer?.name, status: 'error', error: err.message });
      failed++;
    }

    // Small delay between sends to avoid overwhelming the webhook
    await new Promise(r => setTimeout(r, 500));
  }

  return NextResponse.json({
    dryRun,
    total: leads.length,
    sent,
    failed,
    results,
  });
}
