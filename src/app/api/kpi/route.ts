import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// ─── BOSS'S AR BENCHMARK FORMULA ─────────────────────────────────────────────
// Benchmark = (9/28) × 4wk PMP rev
//           + (26.875/56) × 8wk WP rev
//           + (48.375/91) × 13wk IP rev
//           + (0.9/91) × 13wk total rev
//
// Constants derived from:
//   Pest:       (0.4×0 + 0.6×15) / (4×7)          = 9/28
//   Wildlife:   ((1-0.075)×0.5×50 + 0.075×1×50)   / (8×7)  = 26.875/56
//   Insulation: ((1-0.075)×0.5×90 + 0.075×1×90)   / (13×7) = 48.375/91
//   All:        (0.01×90) / (13×7)                           = 0.9/91

const PEST_COEFF       = 9 / 28;        // 4-week trailing PMP
const WILDLIFE_COEFF   = 26.875 / 56;   // 8-week trailing WP
const INSULATION_COEFF = 48.375 / 91;   // 13-week trailing IP
const ALL_COEFF        = 0.9 / 91;      // 13-week trailing total

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;
    const { searchParams } = new URL(req.url);
    const officeParam = searchParams.get('office');

    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Build office filter
    const effectiveOffice = officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN'
      ? officeParam
      : (office && office !== 'ALL' && office !== 'ADMIN' ? office : null);
    const officeFilter = effectiveOffice ? { office: effectiveOffice } : {};

    // Trailing revenue windows
    const weeks4ago  = new Date(); weeks4ago.setDate(today.getDate() - 28);
    const weeks8ago  = new Date(); weeks8ago.setDate(today.getDate() - 56);
    const weeks13ago = new Date(); weeks13ago.setDate(today.getDate() - 91);

    const [openInvoices, recentPayments, trailingInvoices] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: { not: 'PAID' }, ...officeFilter }
      }),
      prisma.payment.findMany({
        where: {
          date: { gte: thirtyDaysAgo },
          invoice: { ...officeFilter }
        }
      }),
      // Pull all paid+current invoices from 13 weeks back for benchmark calc
      prisma.invoice.findMany({
        where: {
          date: { gte: weeks13ago },
          ...officeFilter,
        },
        select: {
          amount: true,
          date: true,
          serviceType: true,
          customer: { select: { serviceType: true } },
        },
      }),
    ]);

    // ─── AR TOTALS ───────────────────────────────────────────────────────────
    const totalAR    = openInvoices.reduce((s: number, i: any) => s + Number(i.amount) - Number(i.paid), 0);
    const overdueAR  = openInvoices.filter((i: any) => ['OVERDUE','COLLECTIONS'].includes(i.status) && i.due)
                        .reduce((s: number, i: any) => s + Number(i.amount) - Number(i.paid), 0);
    const collected30 = recentPayments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const collectionRate = (totalAR + collected30) > 0 ? collected30 / (totalAR + collected30) : 0;
    const avgDaysOut = openInvoices.length
      ? openInvoices.reduce((s: number, i: any) => s + Math.round((today.getTime() - new Date(i.date).getTime()) / 86400000), 0) / openInvoices.length
      : 0;

    const agingTotals: Record<string, number> = { current:0, '1-30':0, '31-60':0, '61-90':0, '90+':0 };
    for (const inv of openInvoices) {
      if (!inv.due) { agingTotals['current'] += Number(inv.amount) - Number(inv.paid); continue; }
      const days = Math.round((today.getTime() - new Date(inv.due).getTime()) / 86400000);
      const bucket = days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      agingTotals[bucket] += Number(inv.amount) - Number(inv.paid);
    }

    // ─── BENCHMARK FORMULA ───────────────────────────────────────────────────
    // Determine service type per invoice: use invoice.serviceType first,
    // fallback to customer.serviceType
    const getTeam = (inv: any): string => {
      const st = (inv.serviceType || inv.customer?.serviceType || '').toLowerCase();
      if (st.includes('insulation') || st === 'ip') return 'IP';
      if (st.includes('wildlife') || st === 'wp') return 'WP';
      if (st.includes('pest') || st === 'pmp') return 'PMP';
      return 'PMP'; // default
    };

    let rev4wkPMP  = 0; // 4wk PMP revenue
    let rev8wkWP   = 0; // 8wk WP revenue
    let rev13wkIP  = 0; // 13wk IP revenue
    let rev13wkAll = 0; // 13wk total revenue

    const w4  = weeks4ago.getTime();
    const w8  = weeks8ago.getTime();
    const w13 = weeks13ago.getTime();

    for (const inv of trailingInvoices) {
      const amt     = Number(inv.amount);
      const invTime = new Date(inv.date).getTime();
      const team    = getTeam(inv);

      rev13wkAll += amt;
      if (team === 'IP')  rev13wkIP  += amt;
      if (team === 'WP'  && invTime >= w8)  rev8wkWP  += amt;
      if (team === 'PMP' && invTime >= w4)  rev4wkPMP += amt;
    }

    const benchmark = Math.round(
      PEST_COEFF       * rev4wkPMP  +
      WILDLIFE_COEFF   * rev8wkWP   +
      INSULATION_COEFF * rev13wkIP  +
      ALL_COEFF        * rev13wkAll
    );

    return NextResponse.json({
      totalAR, overdueAR, collected30, collectionRate, avgDaysOut,
      overduePct: totalAR > 0 ? overdueAR / totalAR : 0,
      arVsBenchmark: benchmark > 0 ? totalAR / benchmark : 0,
      benchmark,
      openCount: openInvoices.length,
      agingTotals,
      // Debug breakdown (can be hidden in UI)
      benchmarkBreakdown: {
        rev4wkPMP:  Math.round(rev4wkPMP),
        rev8wkWP:   Math.round(rev8wkWP),
        rev13wkIP:  Math.round(rev13wkIP),
        rev13wkAll: Math.round(rev13wkAll),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
