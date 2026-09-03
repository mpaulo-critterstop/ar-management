// Compute pest commissions per PM per month from pest_sales, and write the total into
// commission_months.pestControlComm — REPLACING manual entry. Only touches NON-finalized months
// (finalized/locked months are frozen and never recomputed).
//
//   /api/cron/pest-commissions-compute?token=critterstop2026            (all open months)
//   /api/cron/pest-commissions-compute?month=2026-08&token=...          (one month)
//   &dry=1  -> preview without writing
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computePmMonthCommission, perSaleRate, PestCommCategory } from '@/lib/pestCommission';
import { waitUntil } from '@vercel/functions';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const onlyMonth = sp.get('month'); // 'YYYY-MM'
  const dry = sp.get('dry') === '1';
  const debugPm = sp.get('debugPm'); // per-sale breakdown for one PM

  // dry runs inline (need to see the preview). ?wait=1 also inline. Otherwise fire-and-forget via waitUntil.
  if (dry || sp.get('wait') === '1' || debugPm) {
    const result = await runCompute(onlyMonth, dry, debugPm);
    return NextResponse.json(result);
  }
  waitUntil(runCompute(onlyMonth, false, null).catch(e => { console.error('pest-commissions-compute background error:', e); }));
  return NextResponse.json({ ok: true, started: true, month: onlyMonth || 'all-open', note: 'Compute running in background. Use ?dry=1 or ?wait=1 for inline result.' });
}

async function runCompute(onlyMonth: string | null, dry: boolean, debugPm?: string | null) {
  let debugOut: any = null;

  // Pull all completed, commissionable pest sales (source can be fr OR excel, but commission compute is
  // for going-forward FR sales; history commissions are already frozen in commission_months). We compute
  // from ALL pest_sales rows that have a commissionMonth, then only WRITE to non-finalized months.
  // Commission belongs to the month the INITIAL SERVICE completed, regardless of when/where the sale
  // originated (a sale from any prior month serviced this month counts this month). So compute from ALL
  // sources. Double-counting is prevented structurally: finalized months are skipped below (already paid),
  // and a given sale exists once (FR sync only has 8/1+ sales; Excel history has pre-8/1 sales) — no sale
  // appears in both sources, so summing across sources never counts a sale twice.
  const sales = await prisma.pestSale.findMany({
    where: { sellerType: 'pm', commissionMonth: onlyMonth ? onlyMonth : { not: null }, initialDone: true },
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

    // Per-sale line-item breakdown for one PM (debug): show each sale + the commission it earns.
    if (debugPm && pm.toLowerCase().includes(debugPm.toLowerCase()) && (!onlyMonth || month === onlyMonth)) {
      const done = pmSales.filter((s: any) => s.initialCompletedAt != null && s.category !== 'EXCLUDE');
      const gpc = done.filter((s: any) => s.category === 'Pest Control')
        .sort((a: any, b: any) => a.initialCompletedAt.getTime() - b.initialCompletedAt.getTime());
      const lines = done.map((s: any) => {
        let rate: number, note = '';
        if (s.category === 'Pest Control') {
          const idx = gpc.indexOf(s) + 1;
          rate = idx >= 11 ? 0.5 : idx >= 6 ? 0.4 : 0.3;
          note = `GPC #${idx} (marginal)`;
        } else {
          rate = perSaleRate(s.category, s.cv);
        }
        return { category: s.category, cv: s.cv, completedAt: s.initialCompletedAt, rate, commission: Math.round(s.cv * rate * 100) / 100, note };
      });
      const excluded = pmSales.filter((s: any) => s.initialCompletedAt == null || s.category === 'EXCLUDE')
        .map((s: any) => ({ category: s.category, cv: s.cv, completedAt: s.initialCompletedAt, reason: s.category === 'EXCLUDE' ? 'EXCLUDE category' : 'not completed' }));
      debugOut = { pm, month, total: rounded, byCategory, saleCount: done.length, lines, excluded };
    }

    const existing = await prisma.commissionMonth.findUnique({
      where: { pmName_month: { pmName: pm, month: monthDate } },
      select: { finalized: true, pestControlComm: true },
    });

    if (existing?.finalized) { skippedFinalized++; continue; }

    // Pre-live months are frozen display-only history (served from import-history); never create/write them.
    if (monthDate < LIVE_FROM) { skippedHistory++; continue; }

    const entry: any = { pm, month, computed: rounded, byCategory };
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

  // ---- Booked Pest Control CV (KPI) — sum of CV of ALL pest sales (every category) whose initial
  // service completed that month, per PM + company. Same initial-service-date basis as commissions.
  // Computed for LIVE months only (>= Aug 2026 per Mark); Jul and earlier keep their Excel backfill values.
  const CV_LIVE_FROM = new Date(Date.UTC(2026, 7, 1)); // Aug 1 2026
  const cvByPmMonth = new Map<string, number>();   // 'pm||YYYY-MM' -> cv sum
  const cvByCompanyMonth = new Map<string, number>(); // 'YYYY-MM' -> cv sum
  for (const s of sales) {
    if (!s.pmName || !s.commissionMonth) continue;
    const monthDate = new Date(`${s.commissionMonth}-01T00:00:00.000Z`);
    if (monthDate < CV_LIVE_FROM) continue;          // Aug+ only; Jul & history stay from Excel
    const cv = s.contractValue || 0;
    cvByPmMonth.set(`${s.pmName}||${s.commissionMonth}`, (cvByPmMonth.get(`${s.pmName}||${s.commissionMonth}`) || 0) + cv);
    cvByCompanyMonth.set(s.commissionMonth, (cvByCompanyMonth.get(s.commissionMonth) || 0) + cv);
  }
  let cvWritten = 0;
  const upsertCV = async (scope: string, monthKey: string, cv: number) => {
    if (dry) return;
    await prisma.kpiHistory.upsert({
      where: { period_periodKey_scope: { period: 'monthly', periodKey: monthKey, scope } },
      create: { period: 'monthly', periodKey: monthKey, scope, booked: 0, leads: 0, closed: 0, closingPct: 0, avgSale: 0, bookedPerLead: 0, bookedPestCV: Math.round(cv * 100) / 100 },
      update: { bookedPestCV: Math.round(cv * 100) / 100 },
    });
    cvWritten++;
  };
  const cvResults: any[] = [];
  for (const [key, cv] of cvByPmMonth) {
    const [pm, monthKey] = key.split('||');
    await upsertCV(pm, monthKey, cv);
    cvResults.push({ scope: pm, month: monthKey, bookedPestCV: Math.round(cv * 100) / 100 });
  }
  for (const [monthKey, cv] of cvByCompanyMonth) {
    await upsertCV('company', monthKey, cv);
    cvResults.push({ scope: 'company', month: monthKey, bookedPestCV: Math.round(cv * 100) / 100 });
  }

  results.sort((a, b) => (a.month < b.month ? 1 : -1) || (a.pm < b.pm ? -1 : 1));
  cvResults.sort((a, b) => (a.month < b.month ? 1 : -1) || (a.scope < b.scope ? -1 : 1));
  if (debugOut) return { ok: true, debugPm: true, detail: debugOut };
  return { ok: true, dry, groups: groups.size, written, cvWritten, skippedFinalized, skippedHistory, note: 'Commissions: live non-finalized months only. Booked Pest CV: all live months (>= Jul 2026), per PM + company; pre-live months keep Excel history.', results, bookedPestCV: cvResults };
}
