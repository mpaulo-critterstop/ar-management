// Reconcile enrolled-but-already-paid customers.
// The inline paid/partial webhooks in sync/auto only fire on a NEW payment (newPaid > prevPaid) during a
// sync run. Payments that landed while automation was off (or in a run that didn't send) never triggered the
// "stop the drip" signal — so paid customers stay enrolled (arFollowupSent=true) and keep getting dunned.
//
// This endpoint sweeps all enrolled invoices and, for any that are now fully paid (or partially paid),
// fires the AR_PAID (or AR_PARTIAL) webhook to pull them out of / update the PestAI sequence, and clears
// arFollowupSent so they leave the Hub's sequence too.
//
//   Dry run (see who WOULD be affected, fire nothing):
//     /api/cron/ar-reconcile-paid?dry=1&token=critterstop2026
//   Live (fire paid webhooks, un-enroll):
//     /api/cron/ar-reconcile-paid?token=critterstop2026&limit=500
//   Only fully-paid (skip partials):
//     ...&mode=paid
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const AR_PARTIAL_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/AM0p0PhEMlKoBozA9FnB';
const AR_PAID_WEBHOOK     = 'https://services.leadconnectorhq.com/hooks/nvZiDkSBMzQZKMaAY2a4/webhook-trigger/rlu6JwusY1H2fUXOrMli';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const mode = sp.get('mode') || 'all'; // 'all' = paid + partial, 'paid' = fully paid only
  const limit = Math.min(Number(sp.get('limit')) || 500, 2000);

  // Enrolled invoices that are paid or partially paid.
  const invoices = await prisma.invoice.findMany({
    where: {
      arFollowupSent: true,
      paid: { gt: 0 },
      // paid >= amount (fully) handled in code; partials included when mode=all
    },
    include: { customer: { select: { name: true, phone: true, email: true, serviceAddr: true, externalId: true } } },
    take: limit,
  });

  const results: any[] = [];
  let paidFired = 0, partialFired = 0, skipped = 0, failed = 0;

  for (const inv of invoices) {
    const amount = Number(inv.amount || 0);
    const paid = Number(inv.paid || 0);
    const amountDue = Math.max(0, amount - paid);
    const isFullyPaid = amountDue <= 0;
    const isPartial = !isFullyPaid && paid > 0;

    // mode=paid -> only act on fully-paid; skip partials
    if (mode === 'paid' && !isFullyPaid) { skipped++; continue; }
    // must be at least partially paid (already guaranteed by paid>0)
    if (!isFullyPaid && !isPartial) { skipped++; continue; }

    const nameParts = (inv.customer?.name || '').trim().split(' ');
    const payload = {
      fname: nameParts[0] || '', lname: nameParts.slice(1).join(' ') || '',
      phone1: (inv.customer?.phone || '').replace(/\D/g, ''), email: inv.customer?.email || '',
      address: inv.customer?.serviceAddr || '',
      invoiceNumber: inv.externalId || inv.id,
      invoiceAmount: amount.toFixed(2), amountDue: amountDue.toFixed(2),
      dueDate: inv.due ? new Date(inv.due).toISOString().split('T')[0] : '',
      officeName: inv.office || '', customerID: inv.customer?.externalId || inv.customerId,
      event: isFullyPaid ? 'paid_in_full' : 'partial_payment',
    };

    if (dry) {
      results.push({ invoiceId: inv.externalId || inv.id, customer: inv.customer?.name, amount: amount.toFixed(2), paid: paid.toFixed(2), amountDue: amountDue.toFixed(2), wouldFire: payload.event });
      isFullyPaid ? paidFired++ : partialFired++;
      continue;
    }

    try {
      const webhook = isFullyPaid ? AR_PAID_WEBHOOK : AR_PARTIAL_WEBHOOK;
      const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        // Fully paid -> leave the sequence (clear the flag). Partial -> keep enrolled (drip continues at new
        // balance), just re-synced the balance to PestAI.
        if (isFullyPaid) {
          await prisma.invoice.update({ where: { id: inv.id }, data: { arFollowupSent: false } });
          paidFired++;
        } else {
          partialFired++;
        }
        results.push({ invoiceId: inv.externalId || inv.id, customer: inv.customer?.name, fired: payload.event, httpStatus: res.status });
      } else {
        failed++;
        results.push({ invoiceId: inv.externalId || inv.id, customer: inv.customer?.name, status: 'failed', httpStatus: res.status });
      }
    } catch (e: any) {
      failed++;
      results.push({ invoiceId: inv.externalId || inv.id, customer: inv.customer?.name, status: 'error', error: e.message });
    }
    await new Promise(r => setTimeout(r, 1000)); // 1/s throttle, same as ar-followup
  }

  return NextResponse.json({
    ok: true, dry, mode,
    scanned: invoices.length,
    fullyPaid_fired: paidFired, partial_fired: partialFired, skipped, failed,
    results: results.slice(0, 200), // cap output
  });
}
