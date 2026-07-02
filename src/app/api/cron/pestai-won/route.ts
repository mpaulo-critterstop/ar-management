// src/app/api/cron/pestai-won/route.ts
// Daily cron at 7am CST: fires WON webhook to PestAI for leads that were
// sent to the follow-up pipeline and have since converted to SOLD

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const WON_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/aGvw0JWUsOsikqvVKBmn';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dry = searchParams.get('dry') === 'true';

  // Find leads that were sent to PestAI, converted to SOLD, but WON not yet fired
  const leads = await prisma.lead.findMany({
    where: {
      followUpSent: true,
      status: 'SOLD',
      wonSent: false,
    },
    include: {
      customer: { select: { name: true, phone: true, email: true } },
    },
  });

  const results: any[] = [];
  let sent = 0;
  let failed = 0;

  for (const lead of leads) {
    const nameParts = (lead.customer?.name || '').trim().split(' ');
    const fname = nameParts[0] || '';
    const lname = nameParts.slice(1).join(' ') || '';

    const payload = {
      fname,
      lname,
      phone1: (lead.customer?.phone || '').replace(/\D/g, ''),
      email:  lead.customer?.email || '',
      customerID: lead.id,
      salesRep:   lead.pmName || '',
      officeName: lead.office || '',
      status: 'WON',
    };

    if (dry) {
      results.push({ leadId: lead.id, customer: lead.customer?.name, status: 'would_send', payload });
      continue;
    }

    try {
      const res = await fetch(WON_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const resText = await res.text();

      if (res.ok) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { wonSent: true, wonSentAt: new Date() },
        });
        results.push({ leadId: lead.id, customer: lead.customer?.name, status: 'sent', httpStatus: res.status, response: resText });
        sent++;
      } else {
        results.push({ leadId: lead.id, customer: lead.customer?.name, status: 'failed', httpStatus: res.status, response: resText });
        failed++;
      }
    } catch (e: any) {
      results.push({ leadId: lead.id, customer: lead.customer?.name, status: 'error', error: e.message });
      failed++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return NextResponse.json({ dryRun: dry, total: leads.length, sent, failed, results });
}
