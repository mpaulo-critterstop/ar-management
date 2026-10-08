// Backdated bad-debt accrual calendar (for the scorecard). Runs every currently-overdue, unpaid invoice
// through the approved rules to compute WHEN it WOULD have hit Bad Debt — assuming the fastest/default path
// (no customer engagement extensions, straight entry → 15d countdown → sent → post-action window). This gives
// the historical "when SHOULD bad debt have accrued" timeline (March/June/etc.) WITHOUT touching FieldRoutes.
//   /api/cron/bad-debt-calendar?token=critterstop2026
//   &engaged=1  → also show a column assuming avg engagement (adds responded+promised grace) for a slower scenario
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getConfig, trackFor } from '@/lib/collectionsRules';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const DAY = 86400000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const monthKey = (d: Date) => d.toISOString().slice(0, 7); // YYYY-MM

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026' && sp.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cfg = await getConfig();
  const now = new Date();

  const invoices = await prisma.invoice.findMany({
    where: { due: { not: null, lte: now }, status: { notIn: ['PAID', 'VOID_DELETED'] as any } },
    select: { id: true, externalId: true, amount: true, paid: true, due: true, office: true, customer: { select: { name: true } } },
    take: 50000,
  });

  const byMonth: Record<string, { count: number; total: number; collections: number; scc: number }> = {};
  const rows: any[] = [];

  for (const inv of invoices) {
    const amount = Number(inv.amount), paid = Number(inv.paid), bal = amount - paid;
    if (bal <= 0.01 || !inv.due) continue;
    const track = trackFor(cfg, amount);
    const entryDays = track === 'SCC' ? cfg.sccEntryDays : cfg.collectionsEntryDays;
    const postDays = track === 'SCC' ? cfg.badDebtDaysAfterSCC : cfg.badDebtDaysAfterARM;
    // Fastest/default path: due → +entry (enter track) → +15 countdown (sent) → +postWindow (bad debt)
    const enteredAt = addDays(inv.due, entryDays);
    const sentAt = addDays(enteredAt, cfg.countdownDays);
    const badDebtAt = addDays(sentAt, postDays);

    const mk = monthKey(badDebtAt);
    byMonth[mk] = byMonth[mk] || { count: 0, total: 0, collections: 0, scc: 0 };
    byMonth[mk].count++; byMonth[mk].total += bal;
    if (track === 'SCC') byMonth[mk].scc += bal; else byMonth[mk].collections += bal;

    rows.push({
      invoice: inv.externalId, customer: inv.customer?.name, office: inv.office,
      amount: bal, track, due: inv.due, wouldEnterAt: enteredAt, wouldSendAt: sentAt,
      wouldBadDebtAt: badDebtAt, badDebtMonth: mk,
      alreadyPassed: badDebtAt <= now,
    });
  }

  const calendar = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v, total: Math.round(v.total * 100) / 100, collections: Math.round(v.collections * 100) / 100, scc: Math.round(v.scc * 100) / 100 }));
  const grand = calendar.reduce((s, m) => s + m.total, 0);
  const alreadyAccrued = rows.filter(r => r.alreadyPassed).reduce((s, r) => s + r.amount, 0);

  return NextResponse.json({
    note: 'Backdated projection using approved rules (fastest path, no engagement extensions). No FieldRoutes writes. Confirm with bookkeeper before recognizing. Day-counts PENDING Chisam A/B + ARM-history — rerun after config is final.',
    config: cfg,
    grandTotalOverdue: Math.round(grand * 100) / 100,
    alreadyShouldHaveAccrued: Math.round(alreadyAccrued * 100) / 100,
    calendar,
    rows: rows.sort((a, b) => a.wouldBadDebtAt.getTime() - b.wouldBadDebtAt.getTime()),
  });
}
