import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// ─── BENCHMARK SERVICE ID CLASSIFICATION (KPI only — does NOT affect AR sync) ─
// These are used solely to calculate the AR benchmark formula
// The AR sync (auto/route.ts) has its own separate classification — do not merge

const BENCHMARK_IP_IDS = new Set([
  501, 624, 542, 544, 541, 479, 1073, 487, 674,
]);

const BENCHMARK_WP_IDS = new Set([
  533, 538, 509, 1065, 1060, 719, 1064, 1061,
  615, 671, 546, 620, 554, 687, 688,
  677, 619, 682, 496, 1058, 553, 510, 501, 624,
  542, 544, 541, 479, 1073, 487, 674,
  683, 631, 526, 485, 1062, 614, 502, 609,
  670, 636, 1063, 520, 678, 517, 504, 720,
  1059, 189, 287, 686, 685, 690, 691, 684, 645, 489,
]);

const BENCHMARK_PMP_IDS = new Set([
  302, 676, 728, 1017, 1070, 1069, 134, 288, 514, 999, 522, 1075,
  138, 275, 140, 291, 166, 274, 171, 1018, 499, 311, 309, 308, 310,
  307, 718, 644, 642, 703, 607, 1001, 1003, 156, 1004, 1005, 1002,
  640, 1072, 1016, 1010, 1068, 1013, 1014, 1066, 155, 1006, 672,
  1009, 608, 1007, 294, 277, 305, 304, 1015, 543, 495, 646, 622,
  621, 1057, 136, 289, 547, 513, 612, 630, 611, 529, 162, 616, 1008,
  161, 165, 292, 169, 170, 178, 507, 610, 500, 283, 284, 836, 183,
  182, 271, 185, 184, 272, 273, 269, 270, 508, 729, 149, 521, 759,
  493, 494, 301, 681, 313,
]);

function getBenchmarkTeam(serviceId: number | null): 'IP' | 'WP' | 'PMP' {
  if (!serviceId) return 'PMP';
  if (BENCHMARK_IP_IDS.has(serviceId)) return 'IP';
  if (BENCHMARK_WP_IDS.has(serviceId)) return 'WP';
  return 'PMP';
}

// ─── BOSS'S AR BENCHMARK FORMULA ─────────────────────────────────────────────
// = (0.4×0 + 0.6×15)/(4×7) × 4wk PMP rev
// + ((1-0.075)×0.5×(35+15) + 0.075×1×(35+15))/(8×7) × 8wk WP rev
// + ((1-0.075)×0.5×(75+15) + 0.075×1×(75+15))/(13×7) × 13wk IP rev
// + (0.01×90)/(13×7) × 13wk total rev
const PEST_COEFF       = 9 / 28;        // (0+9)/28
const WILDLIFE_COEFF   = 26.875 / 56;   // 26.875/56
const INSULATION_COEFF = 48.375 / 91;   // 48.375/91
const ALL_COEFF        = 0.9 / 91;      // 0.9/91

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;
    const { searchParams } = new URL(req.url);
    const officeParam = searchParams.get('office');

    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const effectiveOffice = officeParam && officeParam !== 'ALL' && officeParam !== 'ADMIN'
      ? officeParam
      : (office && office !== 'ALL' && office !== 'ADMIN' ? office : null);
    const officeFilter = effectiveOffice ? { office: effectiveOffice } : {};

    const weeks4ago  = new Date(); weeks4ago.setDate(today.getDate() - 28);
    const weeks8ago  = new Date(); weeks8ago.setDate(today.getDate() - 56);
    const weeks13ago = new Date(); weeks13ago.setDate(today.getDate() - 91);

    const [openInvoices, recentPayments, trailingInvoices] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: { not: 'PAID' }, ...officeFilter },
      }),
      prisma.payment.findMany({
        where: { date: { gte: thirtyDaysAgo }, invoice: { ...officeFilter } },
      }),
      prisma.invoice.findMany({
        where: { date: { gte: weeks13ago }, ...officeFilter },
        select: { amount: true, date: true, serviceId: true },
      }),
    ]);

    // AR totals
    const totalAR    = openInvoices.reduce((s: number, i: any) => s + Number(i.amount) - Number(i.paid), 0);
    const overdueAR  = openInvoices
      .filter((i: any) => ['OVERDUE','COLLECTIONS'].includes(i.status) && i.due)
      .reduce((s: number, i: any) => s + Number(i.amount) - Number(i.paid), 0);
    const collected30 = recentPayments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const collectionRate = (totalAR + collected30) > 0 ? collected30 / (totalAR + collected30) : 0;
    const avgDaysOut = openInvoices.length
      ? openInvoices.reduce((s: number, i: any) =>
          s + Math.round((today.getTime() - new Date(i.date).getTime()) / 86400000), 0
        ) / openInvoices.length
      : 0;

    const agingTotals: Record<string, number> = { current:0, '1-30':0, '31-60':0, '61-90':0, '90+':0 };
    for (const inv of openInvoices) {
      if (!inv.due) { agingTotals['current'] += Number(inv.amount) - Number(inv.paid); continue; }
      const days = Math.round((today.getTime() - new Date(inv.due).getTime()) / 86400000);
      const bucket = days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      agingTotals[bucket] += Number(inv.amount) - Number(inv.paid);
    }

    // ─── BENCHMARK FORMULA ───────────────────────────────────────────────────
    let rev4wkPMP  = 0;
    let rev8wkWP   = 0;
    let rev13wkIP  = 0;
    let rev13wkAll = 0;

    for (const inv of trailingInvoices) {
      const amt     = Number(inv.amount);
      const invTime = new Date(inv.date).getTime();
      const team    = getBenchmarkTeam(inv.serviceId);

      rev13wkAll += amt;
      if (team === 'IP')  rev13wkIP  += amt;
      if (team === 'WP'  && invTime >= weeks8ago.getTime())  rev8wkWP  += amt;
      if (team === 'PMP' && invTime >= weeks4ago.getTime())  rev4wkPMP += amt;
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
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
