// Compute pest commissions per PM per month from pest_sales, and write the total into
// commission_months.pestControlComm — REPLACING manual entry. Only touches NON-finalized months
// (finalized/locked months are frozen and never recomputed).
//
//   /api/cron/pest-commissions-compute?token=critterstop2026            (all open months)
//   /api/cron/pest-commissions-compute?month=2026-08&token=...          (one month)
//   &dry=1  -> preview without writing
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computePmMonthCommission, PestCommCategory } from '@/lib/pestCommission';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const onlyMonth = sp.get('month'); // 'YYYY-MM'
  const dry = sp.get('dry') === '1';

  // Pull all completed, commissionable pest sales (source can be fr OR excel, but commission compute is
  // for going-forward FR sales; history commissions are already frozen in commission_months). We compute
  // from ALL pest_sales rows that have a commissionMonth, then only WRITE to non-finalized months.
  const sales = await prisma.pestSale.findMany({
    where: { commissionMonth: onlyMonth ? onlyMonth : { not: null }, initialDone: true },
    select: { pmName: true, category: true, contractValue: true, initialCompletedAt: true, commissionMonth: true },
  });

  // Group by pmName + commissionMonth
  const groups = new Map<string, { pm: string; month: string; sales: any[] }>();
  for (const s of sales) {
    if (!s.pmName || !s.commissionMonth) continue;
    const key = `${s.pmName}||${s.commissionMonth}`;
    if (!groups.has(key)) groups.set(key, { pm: s.pmName, month: s.commissionMonth, sales: [] });
    groups.get(key)!.sales.push({
      category: s.category as PestCommCategory,
      cv: s.contractValue || 0,
      initialCompletedAt: s.initialCompletedAt,
    });
  }

  const LIVE_FROM = new Date(Date.UTC(2026, 6, 1)); // Jul 1 2026 — only create rows for live months

  const results: any[] = [];
  let written = 0, skippedFinalized = 0, skippedHistory = 0;

  for (const { pm, month, sales: pmSales } of groups.values()) {
    const { total, byCategory } = computePmMonthCommission(pmSales);
    const monthDate = new Date(`${month}-01T00:00:00.000Z`);
    const rounded = Math.round(total * 100) / 100;

    const existing = await prisma.commissionMonth.findUnique({
      where: { pmName_month: { pmName: pm, month: monthDate } },
      select: { finalized: true, pestControlComm: true },
    });

    const entry: any = { pm, month, computed: rounded, byCategory };

    if (existing?.finalized) { entry.action = 'skipped: finalized'; skippedFinalized++; results.push(entry); continue; }

    // Pre-live months are frozen display-only history (served from import-history); never create/write them.
    if (monthDate < LIVE_FROM) { entry.action = 'skipped: frozen history'; skippedHistory++; results.push(entry); continue; }

    entry.previous = existing?.pestControlComm ?? null;
    entry.action = dry ? (existing ? 'would write' : 'would create') : (existing ? 'written' : 'created');
    if (!dry) {
      await prisma.commissionMonth.upsert({
        where: { pmName_month: { pmName: pm, month: monthDate } },
        create: { pmName: pm, month: monthDate, pestControlComm: rounded },
        update: { pestControlComm: rounded },
      });
      written++;
    }
    results.push(entry);
  }

  results.sort((a, b) => (a.month < b.month ? 1 : -1) || (a.pm < b.pm ? -1 : 1));
  return NextResponse.json({ ok: true, dry, groups: groups.size, written, skippedFinalized, skippedHistory, results });
}
