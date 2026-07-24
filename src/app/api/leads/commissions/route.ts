import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { computeCommission, monthStart, planFor, bucketBreakdown } from '@/lib/commissions';
import { canAccessModule, isOwnDataOnly, perm } from '@/lib/access';

// GET /api/leads/commissions?year=2026 → returns all 12 months for that year, per PM.
// Past months (<= Jun 2026) come from frozen CommissionHistory; Jul 2026+ computed live.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sUser = session.user as any;
  // Module gate: must have access to the leads module.
  if (!canAccessModule(sUser, 'leads')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (perm(sUser, 'hideCommissions')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = Number(searchParams.get('year')) || now.getUTCFullYear();
  let pmParam = searchParams.get('pm') || undefined;

  // ROW-LEVEL: a PM restricted to own data can only ever see their own pmName, regardless of ?pm=.
  if (isOwnDataOnly(sUser)) {
    if (!sUser.pmName) return NextResponse.json({ year, rows: [] }); // no identity → nothing
    pmParam = sUser.pmName;
  }

  // Live cutover: anything strictly after June 2026 is computed; June 2026 and earlier = frozen history.
  const LIVE_FROM = new Date(Date.UTC(2026, 6, 1)); // Jul 1 2026

  const plans = await prisma.commissionPlan.findMany({
    where: { active: true, ...(pmParam ? { pmName: pmParam } : {}) },
    select: { pmName: true, method: true },
  });
  const pmNames = [...new Set(plans.map(p => p.pmName))];
  const methodByPm = new Map(plans.map(p => [p.pmName, p.method]));

  // Pull this year's frozen history for the relevant PMs in one query.
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const history = await prisma.commissionHistory.findMany({
    where: { month: { gte: yearStart, lte: yearEnd }, ...(pmParam ? { pmName: pmParam } : {}) },
  });
  const histKey = (pm: string, m: number) => `${pm}|${m}`;
  const histMap = new Map(history.map(h => [histKey(h.pmName, h.month.getUTCMonth() + 1), h]));

  const rows = [];
  for (const pmName of pmNames) {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const monthDate = new Date(Date.UTC(year, m - 1, 1));
      if (monthDate < LIVE_FROM) {
        // Frozen history month
        const h = histMap.get(histKey(pmName, m));
        if (h) {
          const base: any = {
            month: m, source: 'history',
            bookedRevenue: h.bookedRevenue, cumulativeBookedRevenue: h.cumulativeBookedRevenue,
            prePeriodDelta: h.prePeriodDelta,
            otherAdjustment: h.otherAdjustments, adjustedRevenue: h.adjustedBookedRevenue,
            leadCount: h.numLeads, wildlifeCommission: h.wildlifeCommission,
            pestControlComm: h.pestControlCommission, totalCommission: h.totalCommission,
            finalized: true,
          };
          // For lead_bucket PMs, derive the per-lead + per-bucket display from the frozen
          // totals (numLeads + adjustedBookedRevenue) so finalized months show the same rows.
          if (methodByPm.get(pmName) === 'lead_bucket' && h.numLeads && h.numLeads > 0) {
            const plan = await planFor(pmName, monthDate);
            const adj = h.adjustedBookedRevenue ?? 0;
            base.revPerLead = (h.bookedRevenue ?? 0) / h.numLeads;
            base.adjustedRevPerLead = adj / h.numLeads;
            if (plan) base.buckets = bucketBreakdown(plan.tiers, adj, h.numLeads);
          }
          months.push(base);
        } else {
          months.push({ month: m, source: 'history', empty: true });
        }
      } else if (monthDate <= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) {
        // Live computed month (current or a past live month).
        // Displayed "Booked Revenue" = booked + upsell (totalRevenue), to match the PM KPIs
        // table's definition. computeCommission keeps bookedRevenue (booked-only) and
        // totalRevenue (booked+upsell) separate; the commission math already uses totalRevenue,
        // and history/finalized months keep their frozen figures below (untouched).
        const c = await computeCommission(pmName, year, m);
        months.push({ ...c, bookedRevenue: c.totalRevenue, bookedOnly: c.bookedRevenue, month: m, source: 'live' });
      } else {
        months.push({ month: m, source: 'future', empty: true });
      }
    }
    // Forward-fill cumulative booked revenue for LIVE months: continue from the most recent
    // known cumulative (history) + each subsequent month's booked revenue.
    let runningCum: number | null = null;
    for (const mo of months as any[]) {
      if (mo.empty) continue;
      if (mo.source === 'history') {
        if (mo.cumulativeBookedRevenue != null) runningCum = mo.cumulativeBookedRevenue;
      } else if (mo.source === 'live') {
        if (runningCum != null && mo.totalRevenue != null) {
          runningCum = runningCum + mo.totalRevenue;
          mo.cumulativeBookedRevenue = runningCum;
        } else if (mo.totalRevenue != null) {
          mo.cumulativeBookedRevenue = mo.totalRevenue; // no prior baseline
        }
      }
    }

    rows.push({ pmName, method: methodByPm.get(pmName) ?? 'abr_tiered', months });
  }

  return NextResponse.json({ year, rows });
}

// PATCH /api/leads/commissions  { pmName, year, month, pestControlComm?, otherAdjustment?, otherAdjNote? }
// Upserts the editable manual inputs for a PM-month. Does NOT touch the finalized snapshot.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role;
  if (!['Admin', 'Manager'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { pmName, year, month, pestControlComm, otherAdjustment, otherAdjNote } = body;
  if (!pmName || !year || !month) return NextResponse.json({ error: 'pmName, year, month required' }, { status: 400 });

  const mStart = monthStart(year, month);
  const data: any = {};
  if (pestControlComm !== undefined) data.pestControlComm = Number(pestControlComm) || 0;
  if (otherAdjustment !== undefined) data.otherAdjustment = Number(otherAdjustment) || 0;
  if (otherAdjNote !== undefined) data.otherAdjNote = otherAdjNote || null;

  const record = await prisma.commissionMonth.upsert({
    where: { pmName_month: { pmName, month: mStart } },
    create: { pmName, month: mStart, ...data },
    update: data,
  });
  return NextResponse.json({ success: true, record });
}
