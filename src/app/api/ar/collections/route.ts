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

  // DialPad outreach signal: for each row, find the latest OUTBOUND call to the customer's phone made AFTER the
  // invoice entered collections (answered or not — these customers often don't pick up; "we tried" is the signal).
  // Match on the last 10 digits of the phone (robust against +1 / formatting differences).
  const custIds = [...new Set(rows.map(r => r.customerId).filter(Boolean))] as string[];
  const phoneByCust = new Map<string, string>();
  if (custIds.length) {
    const custs = await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, phone: true } });
    for (const c of custs) if (c.phone) phoneByCust.set(c.id, c.phone.replace(/\D/g, '').slice(-10));
  }
  const phones = [...new Set([...phoneByCust.values()].filter(p => p.length === 10))];
  // outreach: phone10 -> list of {date} outbound calls
  const outreachByPhone = new Map<string, number[]>();
  if (phones.length) {
    // dialpad_calls.external_number stores the raw number; match last 10 digits, outbound only.
    const calls = await prisma.$queryRaw<Array<{ ext: string; ds: bigint }>>`
      SELECT external_number AS ext, date_started AS ds
      FROM dialpad_calls
      WHERE direction = 'outbound'
        AND external_number IS NOT NULL AND external_number != ''
        AND date_started IS NOT NULL
        AND RIGHT(regexp_replace(external_number, '\\D', '', 'g'), 10) = ANY(${phones})
    `;
    for (const c of calls) {
      const p10 = String(c.ext).replace(/\D/g, '').slice(-10);
      if (!outreachByPhone.has(p10)) outreachByPhone.set(p10, []);
      outreachByPhone.get(p10)!.push(Number(c.ds));
    }
  }
  // helper: latest outbound call to this customer after they entered collections
  const outreachFor = (customerId: string | null, enteredAt: Date) => {
    if (!customerId) return { lastOutreachAt: null as string | null, outreachCount: 0 };
    const p10 = phoneByCust.get(customerId);
    if (!p10) return { lastOutreachAt: null, outreachCount: 0 };
    const enteredMs = enteredAt ? new Date(enteredAt).getTime() : 0;
    const after = (outreachByPhone.get(p10) || []).filter(ms => ms >= enteredMs);
    if (!after.length) return { lastOutreachAt: null, outreachCount: 0 };
    return { lastOutreachAt: new Date(Math.max(...after)).toISOString(), outreachCount: after.length };
  };

  const shaped = rows.map(r => ({
    id: r.id, invoiceNumber: r.invoiceNumber, customerName: r.customerName, office: r.office,
    amount: r.amount, dueDate: r.dueDate, track: r.track, stage: r.stage,
    enteredAt: r.enteredAt, countdownEnd: r.countdownEnd,
    respondedAt: r.respondedAt, promisedAt: r.promisedAt, finalCallMadeAt: r.finalCallMadeAt,
    sentAt: r.sentAt, armSubtype: r.armSubtype, badDebtProposedAt: r.badDebtProposedAt, badDebtApprovedAt: r.badDebtApprovedAt,
    // recommended ARM routing for Collections rows not yet sent (what the Send button will do)
    recommendedArm: r.track === 'COLLECTIONS' ? (r.amount >= cfg.contingencyThreshold ? 'CONTINGENCY' : 'FLAT_RATE') : null,
    ...outreachFor(r.customerId, r.enteredAt),
    ...deriveState(cfg, r, now),
  }));

  const status = await prisma.appSetting.findUnique({ where: { key: 'collections_sync_status' } });

  return NextResponse.json({
    config: cfg,
    syncStatus: status?.value || null,
    // Active tabs exclude PAID (written-off / paid in full) — those are resolved and out of AR, so they
    // shouldn't clutter the working lists. (badDebt rows are already filtered to their own section below.)
    collections: shaped.filter(r => r.track === 'COLLECTIONS' && r.stage !== 'PAID' && !r.stage.startsWith('BAD_DEBT')),
    scc: shaped.filter(r => r.track === 'SCC' && r.stage !== 'PAID' && !r.stage.startsWith('BAD_DEBT')),
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
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'invalid date' }, { status: 400 });
      const end = recompute(d, row.promisedAt);
      await prisma.collectionsTracker.update({ where: { id }, data: { respondedAt: d, respondedLoggedAt: new Date(), countdownEnd: end, stage: row.stage === 'ACTION_DUE' ? 'COUNTDOWN' : row.stage } });
      return NextResponse.json({ ok: true });
    }
    case 'logPromised': {
      if (row.promisedAt) return NextResponse.json({ error: 'already logged promised' }, { status: 409 });
      const d = new Date(b.date);
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'invalid date' }, { status: 400 });
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
      if (isNaN(payDate.getTime())) return NextResponse.json({ error: 'invalid date' }, { status: 400 });
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
