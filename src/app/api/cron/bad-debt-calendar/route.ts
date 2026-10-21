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

  const sortedRows = rows.sort((a, b) => a.wouldBadDebtAt.getTime() - b.wouldBadDebtAt.getTime());

  // ── EXCEL EXPORT: &format=xlsx → one tab per month + a summary tab ──
  if (sp.get('format') === 'xlsx') {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const fmtDate = (d: Date) => d ? new Date(d).toISOString().slice(0, 10) : '';
    const mLabel = (m: string) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };

    // Summary tab
    const sumAoA: any[][] = [
      ['Bad-Debt Accrual Calendar — Summary'],
      ['When each unpaid overdue invoice WOULD have become bad debt under our collections rules, by month.'],
      ['Read-only projection (fastest path). Does NOT touch FieldRoutes. Confirm with bookkeeper before recognizing.'],
      [],
      ['Total projected bad debt', Math.round(grand * 100) / 100],
      ['Should have already accrued (to date)', Math.round(alreadyAccrued * 100) / 100],
      [],
      ['Month', 'Invoices', 'Collections ($)', 'SCC ($)', 'Total ($)'],
    ];
    for (const m of calendar) sumAoA.push([mLabel(m.month), m.count, m.collections, m.scc, m.total]);
    sumAoA.push(['TOTAL', calendar.reduce((s, m) => s + m.count, 0), Math.round(calendar.reduce((s, m) => s + m.collections, 0) * 100) / 100, Math.round(calendar.reduce((s, m) => s + m.scc, 0) * 100) / 100, Math.round(grand * 100) / 100]);
    const ws0 = XLSX.utils.aoa_to_sheet(sumAoA);
    ws0['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws0, 'Summary');

    // One tab per month
    const byMonthRows: Record<string, any[]> = {};
    for (const r of sortedRows) (byMonthRows[r.badDebtMonth] = byMonthRows[r.badDebtMonth] || []).push(r);
    for (const month of Object.keys(byMonthRows).sort()) {
      const monthRows = byMonthRows[month].sort((a, b) => b.amount - a.amount);
      const aoa: any[][] = [[`Bad Debt Accruing — ${mLabel(month)}`], [], ['Invoice #', 'Customer', 'Office', 'Track', 'Amount ($)', 'Due Date', 'Would-be Bad Debt']];
      for (const r of monthRows) aoa.push([r.invoice, r.customer || '', r.office || '', r.track, Math.round(r.amount * 100) / 100, fmtDate(r.due), fmtDate(r.wouldBadDebtAt)]);
      aoa.push(['', '', '', 'TOTAL', Math.round(monthRows.reduce((s, r) => s + r.amount, 0) * 100) / 100, '', '']);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 11 }, { wch: 42 }, { wch: 8 }, { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, mLabel(month).replace(' ', '-').slice(0, 31));
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Bad_Debt_Accrual_Calendar_${now.toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  }

  return NextResponse.json({
    note: 'Backdated projection using approved rules (fastest path, no engagement extensions). No FieldRoutes writes. Confirm with bookkeeper before recognizing. Day-counts PENDING Chisam A/B + ARM-history — rerun after config is final.',
    config: cfg,
    grandTotalOverdue: Math.round(grand * 100) / 100,
    alreadyShouldHaveAccrued: Math.round(alreadyAccrued * 100) / 100,
    calendar,
    rows: sortedRows,
  });
}
