// Collections tracker API — list rows + the AR team's human actions.
// GET  → rows grouped by track, with derived state (days left, flags) + config.
// POST → actions: logResponded, logPromised, finalCall, sentToARM, sccFiled, approveBadDebt, partialReset, updateConfig
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getConfig, saveConfig, computeCountdownEnd, deriveState } from '@/lib/collectionsRules';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cfg = await getConfig();
  const now = new Date();

  const rows = await prisma.collectionsTracker.findMany({
    where: { stage: { notIn: ['REMOVED'] } },
    orderBy: [{ countdownEnd: 'asc' }],
    take: 2000,
  });

  const shaped = rows.map(r => ({
    id: r.id, invoiceNumber: r.invoiceNumber, customerName: r.customerName, office: r.office,
    amount: r.amount, dueDate: r.dueDate, track: r.track, stage: r.stage,
    enteredAt: r.enteredAt, countdownEnd: r.countdownEnd,
    respondedAt: r.respondedAt, promisedAt: r.promisedAt, finalCallMadeAt: r.finalCallMadeAt,
    sentAt: r.sentAt, armSubtype: r.armSubtype, badDebtProposedAt: r.badDebtProposedAt, badDebtApprovedAt: r.badDebtApprovedAt,
    // recommended ARM routing for Collections rows not yet sent (what the Send button will do)
    recommendedArm: r.track === 'COLLECTIONS' ? (r.amount >= cfg.contingencyThreshold ? 'CONTINGENCY' : 'FLAT_RATE') : null,
    ...deriveState(cfg, r, now),
  }));

  const status = await prisma.appSetting.findUnique({ where: { key: 'collections_sync_status' } });

  return NextResponse.json({
    config: cfg,
    syncStatus: status?.value || null,
    collections: shaped.filter(r => r.track === 'COLLECTIONS'),
    scc: shaped.filter(r => r.track === 'SCC'),
    badDebt: shaped.filter(r => r.stage === 'BAD_DEBT_PROPOSED' || r.stage === 'BAD_DEBT_APPROVED'),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const cfg = await getConfig();
  const who = (session.user as any)?.name || (session.user as any)?.username || 'AR';

  // Config update (admin): adjust the day-counts once Chisam confirms.
  if (b.action === 'updateConfig') {
    if ((session.user as any)?.role !== 'Admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const merged = await saveConfig(b.config || {});
    return NextResponse.json({ ok: true, config: merged });
  }

  const id = b.id as string;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const row = await prisma.collectionsTracker.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const recompute = (respondedAt: Date | null, promisedAt: Date | null) =>
    computeCountdownEnd(cfg, row.enteredAt, respondedAt, promisedAt);

  switch (b.action) {
    // Customer responded — date-picker gives the actual date. Applies once; locks out the other path? No —
    // responded can precede promised. But promised supersedes. We store both; engine uses promised if present.
    case 'logResponded': {
      if (row.respondedAt) return NextResponse.json({ error: 'already logged responded' }, { status: 409 });
      const d = new Date(b.date);
      const end = recompute(d, row.promisedAt);
      await prisma.collectionsTracker.update({ where: { id }, data: { respondedAt: d, respondedLoggedAt: new Date(), countdownEnd: end, stage: row.stage === 'ACTION_DUE' ? 'COUNTDOWN' : row.stage } });
      return NextResponse.json({ ok: true });
    }
    case 'logPromised': {
      if (row.promisedAt) return NextResponse.json({ error: 'already logged promised' }, { status: 409 });
      const d = new Date(b.date);
      const end = recompute(row.respondedAt, d);
      await prisma.collectionsTracker.update({ where: { id }, data: { promisedAt: d, promisedLoggedAt: new Date(), countdownEnd: end, stage: row.stage === 'ACTION_DUE' ? 'COUNTDOWN' : row.stage } });
      return NextResponse.json({ ok: true });
    }
    // One final call before sending (new per Chisam). Records it; required before Sent/Filed.
    case 'finalCall': {
      await prisma.collectionsTracker.update({ where: { id }, data: { finalCallMadeAt: new Date() } });
      return NextResponse.json({ ok: true });
    }
    case 'sentToARM': {
      if (row.track !== 'COLLECTIONS') return NextResponse.json({ error: 'not a collections row' }, { status: 400 });
      const { armSubtypeFor } = await import('@/lib/collectionsRules');
      const subtype = armSubtypeFor(cfg, row.amount); // < $250 flat rate, $250–$750 contingency
      await prisma.collectionsTracker.update({ where: { id }, data: { stage: 'SENT', sentAt: new Date(), armSubtype: subtype, finalCallMadeAt: row.finalCallMadeAt || new Date() } });
      return NextResponse.json({ ok: true, armSubtype: subtype });
    }
    case 'sccFiled': {
      if (row.track !== 'SCC') return NextResponse.json({ error: 'not an SCC row' }, { status: 400 });
      await prisma.collectionsTracker.update({ where: { id }, data: { stage: 'SENT', sentAt: new Date(), finalCallMadeAt: row.finalCallMadeAt || new Date() } });
      return NextResponse.json({ ok: true });
    }
    // Bad debt is a PROPOSAL — only admin (Chisam) approves. No FR write here (bookkeeper gate separate).
    case 'approveBadDebt': {
      if ((session.user as any)?.role !== 'Admin') return NextResponse.json({ error: 'Only admin can approve bad debt' }, { status: 403 });
      await prisma.collectionsTracker.update({ where: { id }, data: { stage: 'BAD_DEBT_APPROVED', badDebtApprovedAt: new Date(), badDebtApprovedBy: who } });
      return NextResponse.json({ ok: true });
    }
    // Partial payment logged → reset countdown 15d from payment date, re-enable engagement.
    case 'partialReset': {
      const payDate = b.date ? new Date(b.date) : new Date();
      await prisma.collectionsTracker.update({
        where: { id },
        data: { enteredAt: payDate, countdownEnd: computeCountdownEnd(cfg, payDate, null, null), respondedAt: null, respondedLoggedAt: null, promisedAt: null, promisedLoggedAt: null, stage: 'COUNTDOWN', lastPaymentAt: payDate },
      });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}
