import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import monthlyData from '@/data/term_pm_monthly.json';
import weeklyData from '@/data/term_pm_weekly.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Import terminated PMs' monthly + weekly KPI history (extracted from the Leads Tracker Excel) as per-PM
// kpi_history rows, so they flow into per-office reconstruction + the All total. Upserts (overwrites any
// existing $0 rows for these PMs). ?token=critterstop2026 &confirm=1 (dry-run default).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('confirm') !== '1';

  const mo = monthlyData as Record<string, any>;
  const wk = weeklyData as Record<string, any>;

  const derive = (booked: number, leads: number, closed: number) => ({
    closingPct: leads > 0 ? (closed / leads) * 100 : 0,
    avgSale: closed > 0 ? booked / closed : 0,
    bookedPerLead: leads > 0 ? booked / leads : 0,
  });

  const plan: any[] = [];
  // monthly
  for (const [name, d] of Object.entries(mo)) {
    for (const [key, m] of Object.entries(d.months as Record<string, any>)) {
      plan.push({ period: 'monthly', periodKey: key, scope: name, booked: m.booked, leads: m.leads, closed: m.closed,
        ...derive(m.booked, m.leads, m.closed), cashCollected: m.cash ?? null, bookedPestCV: m.pestCV ?? null });
    }
  }
  // weekly
  for (const [name, d] of Object.entries(wk)) {
    for (const [key, w] of Object.entries(d.weeks as Record<string, any>)) {
      plan.push({ period: 'weekly', periodKey: key, scope: name, booked: w.booked, leads: w.leads, closed: w.closed,
        ...derive(w.booked, w.leads, w.closed), cashCollected: null, bookedPestCV: null });
    }
  }

  if (dry) {
    const byPm: Record<string, { monthly: number; weekly: number }> = {};
    for (const p of plan) { byPm[p.scope] = byPm[p.scope] || { monthly: 0, weekly: 0 }; byPm[p.scope][p.period === 'monthly' ? 'monthly' : 'weekly']++; }
    return NextResponse.json({ dry: true, totalRows: plan.length, byPm, note: 'add &confirm=1 to upsert these into kpi_history' });
  }

  let upserted = 0;
  for (const p of plan) {
    await prisma.kpiHistory.upsert({
      where: { period_periodKey_scope: { period: p.period, periodKey: p.periodKey, scope: p.scope } },
      create: p, update: { booked: p.booked, leads: p.leads, closed: p.closed, closingPct: p.closingPct, avgSale: p.avgSale, bookedPerLead: p.bookedPerLead, cashCollected: p.cashCollected, bookedPestCV: p.bookedPestCV },
    });
    upserted++;
  }
  return NextResponse.json({ ok: true, upserted });
}
