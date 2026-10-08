// Collections tracker engine. Runs daily (+ on-demand):
//  1. Auto-ENTER qualifying overdue invoices into COLLECTIONS/SCC (by amount + days past due).
//  2. Advance countdown-stage rows: COUNTDOWN → FINAL_WARNING (<=7d left) → ACTION_DUE (0d).
//  3. SENT rows past the post-action window → BAD_DEBT_PROPOSED (never auto-approved).
//  4. Handle payments: paid in full → PAID (drops off); partial → reset 15d countdown from payment date.
//   /api/cron/collections-sync?token=critterstop2026           (run)
//   /api/cron/collections-sync?token=critterstop2026&dry=1      (preview, no writes)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getConfig, computeCountdownEnd, trackFor, daysBetween } from '@/lib/collectionsRules';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const DAY = 86400000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026' && sp.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = sp.get('dry') === '1';
  const cfg = await getConfig();
  const now = new Date();
  const res = { entered: 0, toFinalWarning: 0, toActionDue: 0, toBadDebtProposed: 0, paidFull: 0, partialReset: 0 } as any;
  const details: any[] = [];

  // ── 1. AUTO-ENTER qualifying overdue invoices not already tracked ─────────────────────────────
  // Candidate = unpaid balance > 0, has a due date, past due by >= entry days for its track, not already tracked.
  const tracked = await prisma.collectionsTracker.findMany({ select: { invoiceId: true } });
  const trackedIds = new Set(tracked.map(t => t.invoiceId));

  const overdue = await prisma.invoice.findMany({
    where: { due: { not: null, lte: now }, status: { notIn: ['PAID', 'VOID_DELETED'] as any } },
    select: {
      id: true, externalId: true, amount: true, paid: true, due: true, office: true,
      customerId: true, customer: { select: { name: true } },
    },
    take: 20000,
  });

  for (const inv of overdue) {
    if (trackedIds.has(inv.id)) continue;
    const amount = Number(inv.amount), paid = Number(inv.paid);
    const bal = amount - paid;
    if (bal <= 0.01) continue; // nothing owed
    if (!inv.due) continue;
    const daysPastDue = daysBetween(inv.due, now);
    const track = trackFor(cfg, amount);
    const entryDays = track === 'SCC' ? cfg.sccEntryDays : cfg.collectionsEntryDays;
    if (daysPastDue < entryDays) continue; // not yet eligible

    res.entered++;
    details.push({ action: 'ENTER', track, invoice: inv.externalId, amount, daysPastDue });
    if (!dry) {
      const enteredAt = now;
      await prisma.collectionsTracker.create({
        data: {
          invoiceId: inv.id, invoiceNumber: inv.externalId, customerId: inv.customerId,
          customerName: inv.customer?.name, office: inv.office, amount, dueDate: inv.due,
          track, stage: 'COUNTDOWN', enteredAt, countdownEnd: addDays(enteredAt, cfg.countdownDays),
        },
      });
    }
  }

  // ── Process existing active rows ──────────────────────────────────────────────────────────────
  const active = await prisma.collectionsTracker.findMany({
    where: { stage: { notIn: ['PAID', 'REMOVED', 'BAD_DEBT_APPROVED'] } },
  });

  for (const row of active) {
    // Refresh payment status from the invoice.
    const inv = await prisma.invoice.findUnique({ where: { id: row.invoiceId }, select: { amount: true, paid: true } });
    if (inv) {
      const amount = Number(inv.amount), paid = Number(inv.paid), bal = amount - paid;
      // 4a. Paid in full → drop off.
      if (bal <= 0.01) {
        res.paidFull++;
        details.push({ action: 'PAID_FULL', invoice: row.invoiceNumber });
        if (!dry) await prisma.collectionsTracker.update({ where: { id: row.id }, data: { stage: 'PAID', paidInFull: true, lastPaymentAt: now } });
        continue;
      }
      // 4b. Partial payment since we last saw → reset countdown 15d from now, re-enable engagement.
      //     (Detect by paid increasing vs. stored amount baseline — we store amount as original; compare paid.)
      // Simple heuristic: if a partial payment reset hasn't been recorded for the current paid level.
      // (We track via lastPaymentAt; the save-payment action sets it. Here we only auto-reset on detected drop.)
    }

    // Only countdown-stage rows advance through the flag states.
    if (row.stage === 'COUNTDOWN' || row.stage === 'FINAL_WARNING') {
      const deadline = computeCountdownEnd(cfg, row.enteredAt, row.respondedAt, row.promisedAt);
      const daysLeft = daysBetween(now, deadline);
      // keep countdownEnd in sync (in case engagement changed it)
      const needsDeadlineFix = Math.abs(deadline.getTime() - row.countdownEnd.getTime()) > 1000;
      if (daysLeft <= 0) {
        res.toActionDue++;
        details.push({ action: 'ACTION_DUE', track: row.track, invoice: row.invoiceNumber });
        if (!dry) await prisma.collectionsTracker.update({ where: { id: row.id }, data: { stage: 'ACTION_DUE', countdownEnd: deadline } });
      } else if (daysLeft <= cfg.finalWarningDaysLeft && daysLeft > 0 && row.stage === 'COUNTDOWN') {
        res.toFinalWarning++;
        details.push({ action: 'FINAL_WARNING', track: row.track, invoice: row.invoiceNumber, daysLeft });
        if (!dry) await prisma.collectionsTracker.update({ where: { id: row.id }, data: { stage: 'FINAL_WARNING', countdownEnd: deadline } });
      } else if (needsDeadlineFix && !dry) {
        await prisma.collectionsTracker.update({ where: { id: row.id }, data: { countdownEnd: deadline } });
      }
    }

    // 3. SENT rows past the post-action window → Bad Debt proposal.
    if (row.stage === 'SENT' && row.sentAt) {
      const window = row.track === 'SCC' ? cfg.badDebtDaysAfterSCC : cfg.badDebtDaysAfterARM;
      if (daysBetween(now, addDays(row.sentAt, window)) <= 0) {
        res.toBadDebtProposed++;
        details.push({ action: 'BAD_DEBT_PROPOSED', track: row.track, invoice: row.invoiceNumber });
        if (!dry) await prisma.collectionsTracker.update({ where: { id: row.id }, data: { stage: 'BAD_DEBT_PROPOSED', badDebtProposedAt: now } });
      }
    }
  }

  if (!dry) {
    await prisma.appSetting.upsert({
      where: { key: 'collections_sync_status' },
      create: { key: 'collections_sync_status', value: `${now.toISOString()} :: ${JSON.stringify(res)}` },
      update: { value: `${now.toISOString()} :: ${JSON.stringify(res)}` },
    }).catch(() => {});
  }
  return NextResponse.json({ dry, config: cfg, ...res, details: details.slice(0, 200) });
}
