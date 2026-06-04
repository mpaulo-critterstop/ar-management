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

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const officeFilter = searchParams.get('office');
    const pmFilter = searchParams.get('pm');
    const period = searchParams.get('period') || 'monthly';

    // Get all active PMs
    const pms = await prisma.pM.findMany({ where: { active: true }, orderBy: { name: 'asc' } });

    const now = new Date();

    if (period === 'monthly') {
      // Build 12 month periods (current month first)
      const months: { year: number; month: number; start: Date; end: Date }[] = [];
      for (let i = 0; i < 12; i++) {
        const year = now.getMonth() - i < 0 ? now.getFullYear() - 1 : now.getFullYear();
        const month = ((now.getMonth() - i) + 12) % 12;
        months.push({ year, month, start: getMonthStart(year, month), end: getMonthEnd(year, month) });
      }

      // Fetch all leads and payments in one go
      const allLeads = await prisma.lead.findMany({
        where: {
          inspectionDate: { gte: months[11].start, lte: months[0].end },
          ...(officeFilter && officeFilter !== 'All' && { office: { equals: officeFilter, mode: 'insensitive' } }),
        },
        include: { invoice: { select: { amount: true, date: true } } },
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
      const companyMonthly = months.map(({ year, month, start, end }) => {
        const monthLeads = allLeads.filter(l => l.inspectionDate && new Date(l.inspectionDate) >= start && new Date(l.inspectionDate) <= end);
        const totalLeads = monthLeads.length;
        const soldByInspection = monthLeads.filter(l => l.status === 'SOLD');
        const totalClosed = soldByInspection.length;
        // Booked based on sold date
        const soldBySoldDate = allLeads.filter(l => l.status === 'SOLD' && l.invoice?.date && new Date(l.invoice.date) >= start && new Date(l.invoice.date) <= end);
        const booked = soldBySoldDate.reduce((s, l) => s + Number(l.amount || 0), 0);
        const closingPct = totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0;
        const avgSale = totalClosed > 0 ? booked / totalClosed : 0;
        const bookedPerLead = totalLeads > 0 ? booked / totalLeads : 0;

        // YoY - same month last year
        const lastYearLeads = allLeads.filter(l => {
          if (!l.inspectionDate) return false;
          const d = new Date(l.inspectionDate);
          return d.getFullYear() === year - 1 && d.getMonth() === month && l.status === 'SOLD';
        });
        const lastYearBooked = lastYearLeads.reduce((s, l) => s + Number(l.amount || 0), 0);
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

        const monthData = months.map(({ year, month, start, end }) => {
          const monthLeads = pmLeads.filter(l => l.inspectionDate && new Date(l.inspectionDate) >= start && new Date(l.inspectionDate) <= end);
          const totalLeads = monthLeads.length;
          const soldByInspection = monthLeads.filter(l => l.status === 'SOLD');
          const totalClosed = soldByInspection.length;
          const soldBySoldDate = pmLeads.filter(l => l.status === 'SOLD' && l.invoice?.date && new Date(l.invoice.date) >= start && new Date(l.invoice.date) <= end);
          const booked = soldBySoldDate.reduce((s, l) => s + Number(l.amount || 0), 0);
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

      return NextResponse.json({ period: 'monthly', labels: companyMonthly.map(m => m.label), company: companyMonthly, pms: pmMonthly });

    } else {
      // Weekly - 12 weeks trailing from this Monday
      const thisMonday = getMondayOf(now);
      const weeks: { start: Date; end: Date; label: string }[] = [];
      for (let i = 0; i < 12; i++) {
        const monday = new Date(thisMonday);
        monday.setDate(monday.getDate() - i * 7);
        weeks.push({ start: monday, end: getWeekEnd(monday), label: monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
      }

      const allLeads = await prisma.lead.findMany({
        where: {
          inspectionDate: { gte: weeks[11].start, lte: weeks[0].end },
          ...(officeFilter && officeFilter !== 'All' && { office: { equals: officeFilter, mode: 'insensitive' } }),
        },
        include: { invoice: { select: { amount: true, date: true } } },
      });

      // Company weekly
      const companyWeekly = weeks.map(({ start, end, label }) => {
        const weekLeads = allLeads.filter(l => l.inspectionDate && new Date(l.inspectionDate) >= start && new Date(l.inspectionDate) <= end);
        const totalLeads = weekLeads.length;
        const soldByInspection = weekLeads.filter(l => l.status === 'SOLD');
        const totalClosed = soldByInspection.length;
        const soldBySoldDate = allLeads.filter(l => l.status === 'SOLD' && l.invoice?.date && new Date(l.invoice.date) >= start && new Date(l.invoice.date) <= end);
        const booked = soldBySoldDate.reduce((s, l) => s + Number(l.amount || 0), 0);
        const closingPct = totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0;
        const avgSale = totalClosed > 0 ? booked / totalClosed : 0;
        const bookedPerLead = totalLeads > 0 ? booked / totalLeads : 0;
        return { label, booked, totalLeads, totalClosed, closingPct, avgSale, bookedPerLead };
      });

      // PM weekly
      const pmWeekly = pms.map(pm => {
        const pmLeads = allLeads.filter(l => l.pmName === pm.name);
        const weekData = weeks.map(({ start, end }) => {
          const weekLeads = pmLeads.filter(l => l.inspectionDate && new Date(l.inspectionDate) >= start && new Date(l.inspectionDate) <= end);
          const totalLeads = weekLeads.length;
          const soldByInspection = weekLeads.filter(l => l.status === 'SOLD');
          const totalClosed = soldByInspection.length;
          const soldBySoldDate = pmLeads.filter(l => l.status === 'SOLD' && l.invoice?.date && new Date(l.invoice.date) >= start && new Date(l.invoice.date) <= end);
          const booked = soldBySoldDate.reduce((s, l) => s + Number(l.amount || 0), 0);
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

      return NextResponse.json({ period: 'weekly', labels: companyWeekly.map(w => w.label), company: companyWeekly, pms: pmWeekly });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
