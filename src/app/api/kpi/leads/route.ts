import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function getMonthStart(year: number, month: number) {
  return new Date(year, month, 1);
}
function getMonthEnd(year: number, month: number) {
  return new Date(year, month + 1, 0, 23, 59, 59, 999);
}
function getMondayOf(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function getWeekEnd(monday: Date) {
  const d = new Date(monday);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

  // Historical monthly booked revenue (hardcoded) — Jul 2024 through Dec 2025
const HISTORICAL_BOOKED: Record<string, number> = {
  '2024-6': 187334.00,   // Jul 2024
  '2024-7': 192642.53,   // Aug 2024
  '2024-8': 195843.17,   // Sep 2024
  '2024-9': 261054.99,   // Oct 2024
  '2024-10': 316184.32,  // Nov 2024
  '2024-11': 413299.22,  // Dec 2024
  '2025-0': 441981.36,   // Jan 2025
  '2025-1': 456379.09,   // Feb 2025
  '2025-2': 513299.59,   // Mar 2025
  '2025-3': 595317.27,   // Apr 2025
  '2025-4': 491557.80,   // May 2025
  '2025-5': 387168.43,   // Jun 2025
  '2025-6': 393330.75,   // Jul 2025
  '2025-7': 321587.67,   // Aug 2025
  '2025-8': 386202.19,   // Sep 2025
  '2025-9': 511595.37,   // Oct 2025
  '2025-10': 582926.77,  // Nov 2025
  '2025-11': 573019.54,  // Dec 2025
};


export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const officeFilter = searchParams.get('office');
    const pmFilter = searchParams.get('pm');
    const period = searchParams.get('period') || 'monthly';
    // companyCount = how many periods the COMPANY-WIDE table shows (default 12, grows via "Load more").
    // Per-PM tables always stay at 12. Older company periods (pre-2026) come from kpi_history.
    const companyCount = Math.min(120, Math.max(12, parseInt(searchParams.get('companyCount') || '12')));

    // Get all active PMs
    const pms = await prisma.pM.findMany({ where: { active: true }, orderBy: { name: 'asc' } });

    const now = new Date();

    if (period === 'monthly') {
      // Company table spans `companyCount` months; per-PM tables use the first 12 of these.
      const months: { year: number; month: number; start: Date; end: Date }[] = [];
      for (let i = 0; i < companyCount; i++) {
        const year = now.getMonth() - i < 0 ? now.getFullYear() + Math.floor((now.getMonth() - i) / 12) : now.getFullYear();
        const month = ((now.getMonth() - i) % 12 + 12) % 12;
        months.push({ year, month, start: getMonthStart(year, month), end: getMonthEnd(year, month) });
      }
      const pmMonthsWindow = months.slice(0, 12); // per-PM stays at rolling 12

      // Fetch all leads and payments in one go
      const allLeads = await prisma.lead.findMany({
        where: {
          inspectionDate: { gte: months[months.length - 1].start, lte: months[0].end },
          ...(officeFilter && officeFilter !== 'All' && { office: { equals: officeFilter, mode: 'insensitive' } }),
          ...(pmFilter && { pmName: pmFilter }),        },
        select: { id: true, inspectionDate: true, status: true, amount: true, pmName: true, office: true, upsellAmount: true, upsellDate: true, invoice: { select: { amount: true, date: true } } },
      });

      const allPayments = await prisma.payment.findMany({
        where: {
          date: { gte: new Date('2025-01-01'), lte: months[0].end },
          invoice: {
            lead: {
              status: 'SOLD',
              ...(officeFilter && officeFilter !== 'All' && { office: { equals: officeFilter, mode: 'insensitive' } }),
            },
          },
        },
        include: { invoice: { include: { lead: { select: { pmName: true, office: true } } } } },
      });

      // Build company-wide monthly KPIs
      // Prior-year booked lookup for YoY: prefer kpi_history (all pre-2026 months), then the
      // hardcoded HISTORICAL_BOOKED, then live-computed months in this same window.
      const allHist = await prisma.kpiHistory.findMany({ where: { period: 'monthly', scope: 'company' } });
      const histBookedByKey = new Map(allHist.map(h => [h.periodKey, h.booked])); // 'YYYY-MM' -> booked
      const priorYearBooked = (year: number, month0: number): number => {
        // 1) kpi_history (periodKey is 1-based YYYY-MM)
        const hk = `${year - 1}-${String(month0 + 1).padStart(2, '0')}`;
        if (histBookedByKey.has(hk)) return histBookedByKey.get(hk)!;
        // 2) hardcoded fallback (keyed year-monthIndex, 0-based)
        const legacy = HISTORICAL_BOOKED[`${year - 1}-${month0}`];
        if (legacy != null) return legacy;
        return 0;
      };

      const companyMonthly = months.map(({ year, month, start, end }) => {
        const monthLeads = allLeads.filter(l => l.inspectionDate && new Date(l.inspectionDate) >= start && new Date(l.inspectionDate) <= end);
        const totalLeads = monthLeads.length;
        const soldByInspection = monthLeads.filter(l => l.status === 'SOLD');
        const totalClosed = soldByInspection.length;
        // Booked based on sold date
        const soldBySoldDate = allLeads.filter(l => l.status === 'SOLD' && l.invoice?.date && new Date(l.invoice.date) >= start && new Date(l.invoice.date) <= end);
        const upsellBySoldDate = allLeads.filter(l => l.upsellAmount && l.upsellDate && new Date(l.upsellDate) >= start && new Date(l.upsellDate) <= end);
        const booked = soldBySoldDate.reduce((s, l) => s + Number(l.amount || 0), 0) + upsellBySoldDate.reduce((s, l) => s + Number(l.upsellAmount || 0), 0);
        const closingPct = totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0;
        const avgSale = totalClosed > 0 ? booked / totalClosed : 0;
        const bookedPerLead = totalLeads > 0 ? booked / totalLeads : 0;

        // YoY - same month last year
        const lastYearBooked = priorYearBooked(year, month);
        const yoyGrowth = lastYearBooked > 0 ? ((booked - lastYearBooked) / lastYearBooked) * 100 : null;

        return {
          label: new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          booked, totalLeads, totalClosed, closingPct, avgSale, bookedPerLead, yoyGrowth,
        };
      });

      // Build PM monthly KPIs
      const pmMonthly = pms.map(pm => {
        const pmLeads = allLeads.filter(l => l.pmName === pm.name);
        const pmPayments = allPayments.filter(p => p.invoice?.lead?.pmName === pm.name);

        const monthData = pmMonthsWindow.map(({ year, month, start, end }) => {
          const monthLeads = pmLeads.filter(l => l.inspectionDate && new Date(l.inspectionDate) >= start && new Date(l.inspectionDate) <= end);
          const totalLeads = monthLeads.length;
          const soldByInspection = monthLeads.filter(l => l.status === 'SOLD');
          const totalClosed = soldByInspection.length;
          const soldBySoldDate = pmLeads.filter(l => l.status === 'SOLD' && l.invoice?.date && new Date(l.invoice.date) >= start && new Date(l.invoice.date) <= end);
          const upsellBySoldDate = pmLeads.filter(l => l.upsellAmount && l.upsellDate && new Date(l.upsellDate) >= start && new Date(l.upsellDate) <= end);
          const booked = soldBySoldDate.reduce((s, l) => s + Number(l.amount || 0), 0) + upsellBySoldDate.reduce((s, l) => s + Number(l.upsellAmount || 0), 0);
          const closingPct = totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0;
          const avgSale = totalClosed > 0 ? booked / totalClosed : 0;
          const bookedPerLead = totalLeads > 0 ? booked / totalLeads : 0;
          const cashCollected = pmPayments
            .filter(p => p.date && new Date(p.date) >= start && new Date(p.date) <= end)
            .reduce((s, p) => s + Number(p.amount || 0), 0);

          return { booked, cashCollected, totalLeads, totalClosed, closingPct, avgSale, bookedPerLead };
        });

        return { pm: pm.name, office: pm.office, months: monthData };
      });

      // Overlay stored history for pre-2026 periods (locked numbers from the legacy tracker).
      const histMonths = await prisma.kpiHistory.findMany({ where: { period: 'monthly', scope: 'company' } });
      const histMap = new Map(histMonths.map(h => [h.periodKey, h]));
      const companyMonthlyFinal = companyMonthly.map((m, i) => {
        const { year, month } = months[i];
        if (year >= 2026) return m;
        const h = histMap.get(`${year}-${String(month + 1).padStart(2, '0')}`);
        if (!h) return m; // no stored history for this month → leave computed (likely zeros)
        // Use the tracker's own YoY if present; else derive from prior-year stored booked.
        const priorBooked = priorYearBooked(year, month);
        const yoy = h.yoy != null ? h.yoy : (priorBooked > 0 ? ((h.booked - priorBooked) / priorBooked) * 100 : null);
        return {
          label: m.label,
          booked: h.booked, totalLeads: h.leads, totalClosed: h.closed,
          closingPct: h.closingPct, avgSale: h.avgSale, bookedPerLead: h.bookedPerLead,
          yoyGrowth: yoy,
        };
      });

      return NextResponse.json({ period: 'monthly', companyCount, labels: companyMonthlyFinal.map(m => m.label), pmLabels: companyMonthlyFinal.slice(0, 12).map(m => m.label), company: companyMonthlyFinal, pms: pmMonthly });

    } else {
      // Weekly - company table spans `companyCount` weeks; per-PM uses first 12.
      const thisMonday = getMondayOf(now);
      const weeks: { start: Date; end: Date; label: string }[] = [];
      for (let i = 0; i < companyCount; i++) {
        const monday = new Date(thisMonday);
        monday.setDate(monday.getDate() - i * 7);
        weeks.push({ start: monday, end: getWeekEnd(monday), label: monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
      }
      const pmWeeksWindow = weeks.slice(0, 12);

      const allLeads = await prisma.lead.findMany({
        where: {
          inspectionDate: { gte: weeks[weeks.length - 1].start, lte: weeks[0].end },
...(officeFilter && officeFilter !== 'All' && { office: { equals: officeFilter, mode: 'insensitive' } }),
          ...(pmFilter && { pmName: pmFilter }),
        },
        select: { id: true, inspectionDate: true, status: true, amount: true, pmName: true, office: true, upsellAmount: true, upsellDate: true, invoice: { select: { amount: true, date: true } } },
      });

      // Company weekly
      const companyWeekly = weeks.map(({ start, end, label }) => {
        const weekLeads = allLeads.filter(l => l.inspectionDate && new Date(l.inspectionDate) >= start && new Date(l.inspectionDate) <= end);
        const totalLeads = weekLeads.length;
        const soldByInspection = weekLeads.filter(l => l.status === 'SOLD');
        const totalClosed = soldByInspection.length;
        const soldBySoldDate = allLeads.filter(l => l.status === 'SOLD' && l.invoice?.date && new Date(l.invoice.date) >= start && new Date(l.invoice.date) <= end);
        const upsellBySoldDate = allLeads.filter(l => l.upsellAmount && l.upsellDate && new Date(l.upsellDate) >= start && new Date(l.upsellDate) <= end);
        const booked = soldBySoldDate.reduce((s, l) => s + Number(l.amount || 0), 0) + upsellBySoldDate.reduce((s, l) => s + Number(l.upsellAmount || 0), 0);
        const closingPct = totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0;
        const avgSale = totalClosed > 0 ? booked / totalClosed : 0;
        const bookedPerLead = totalLeads > 0 ? booked / totalLeads : 0;
        return { label, booked, totalLeads, totalClosed, closingPct, avgSale, bookedPerLead };
      });

      // PM weekly
      const pmWeekly = pms.map(pm => {
        const pmLeads = allLeads.filter(l => l.pmName === pm.name);
        const weekData = pmWeeksWindow.map(({ start, end }) => {
          const weekLeads = pmLeads.filter(l => l.inspectionDate && new Date(l.inspectionDate) >= start && new Date(l.inspectionDate) <= end);
          const totalLeads = weekLeads.length;
          const soldByInspection = weekLeads.filter(l => l.status === 'SOLD');
          const totalClosed = soldByInspection.length;
          const soldBySoldDate = pmLeads.filter(l => l.status === 'SOLD' && l.invoice?.date && new Date(l.invoice.date) >= start && new Date(l.invoice.date) <= end);
          const upsellBySoldDate = pmLeads.filter(l => l.upsellAmount && l.upsellDate && new Date(l.upsellDate) >= start && new Date(l.upsellDate) <= end);
          const booked = soldBySoldDate.reduce((s, l) => s + Number(l.amount || 0), 0) + upsellBySoldDate.reduce((s, l) => s + Number(l.upsellAmount || 0), 0);
          const closingPct = totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0;
          const avgSale = totalClosed > 0 ? booked / totalClosed : 0;
          const bookedPerLead = totalLeads > 0 ? booked / totalLeads : 0;

          // Trailing 4 week booked/lead
          return { booked, totalLeads, totalClosed, closingPct, avgSale, bookedPerLead };
        });

        // Add trailing 4 week for each week
        const weekDataWithTrailing = weekData.map((w, i) => {
          const trail = weekData.slice(i, i + 4);
          const trailLeads = trail.reduce((s, t) => s + t.totalLeads, 0);
          const trailBooked = trail.reduce((s, t) => s + t.booked, 0);
          const trailing4WeekBPL = trailLeads > 0 ? trailBooked / trailLeads : 0;
          return { ...w, trailing4WeekBPL };
        });

        return { pm: pm.name, office: pm.office, weeks: weekDataWithTrailing };
      });

      // Overlay stored weekly history for pre-2026 (locked legacy numbers), matched by week-end date.
      const histWeeks = await prisma.kpiHistory.findMany({ where: { period: 'weekly', scope: 'company' } });
      const histWMap = new Map(histWeeks.map(h => [h.periodKey, h]));
      const companyWeeklyFinal = companyWeekly.map((w, i) => {
        const wEnd = weeks[i].end;
        if (wEnd.getFullYear() >= 2026) return w;
        const key = wEnd.toISOString().slice(0, 10);
        const h = histWMap.get(key);
        if (!h) return w;
        return { label: w.label, booked: h.booked, totalLeads: h.leads, totalClosed: h.closed,
                 closingPct: h.closingPct, avgSale: h.avgSale, bookedPerLead: h.bookedPerLead,
                 trailing4WeekBPL: (w as any).trailing4WeekBPL ?? 0 };
      });

      return NextResponse.json({ period: 'weekly', companyCount, labels: companyWeeklyFinal.map(w => w.label), pmLabels: companyWeeklyFinal.slice(0, 12).map(w => w.label), company: companyWeeklyFinal, pms: pmWeekly });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
