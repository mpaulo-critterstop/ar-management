import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const AR_BENCHMARK = 285000;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;

    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const officeFilter = office && office !== "ALL" ? { office } : {};

    const [openInvoices, recentPayments] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: { not: "PAID" }, ...officeFilter }
      }),
      prisma.payment.findMany({
        where: {
          date: { gte: thirtyDaysAgo },
          invoice: { ...officeFilter }
        }
      }),
    ]);

    const totalAR = openInvoices.reduce((s, i) => s + Number(i.amount) - Number(i.paid), 0);
    const overdueAR = openInvoices.filter(i => ["OVERDUE","COLLECTIONS"].includes(i.status) && i.due).reduce((s, i) => s + Number(i.amount) - Number(i.paid), 0);
    const collected30 = recentPayments.reduce((s, p) => s + Number(p.amount), 0);
    const collectionRate = (totalAR + collected30) > 0 ? collected30 / (totalAR + collected30) : 0;
    const avgDaysOut = openInvoices.length ? openInvoices.reduce((s, i) => s + Math.round((today.getTime() - new Date(i.date).getTime()) / 86400000), 0) / openInvoices.length : 0;

    const agingTotals: Record<string, number> = { current:0, "1-30":0, "31-60":0, "61-90":0, "90+":0 };
    for (const inv of openInvoices) {
      if (!inv.due) { agingTotals["current"] += Number(inv.amount) - Number(inv.paid); continue; }
      const days = Math.round((today.getTime() - new Date(inv.due).getTime()) / 86400000);
      const bucket = days <= 0 ? "current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      agingTotals[bucket] += Number(inv.amount) - Number(inv.paid);
    }

    return NextResponse.json({
      totalAR, overdueAR, collected30, collectionRate, avgDaysOut,
      overduePct: totalAR > 0 ? overdueAR / totalAR : 0,
      arVsBenchmark: totalAR / AR_BENCHMARK,
      benchmark: AR_BENCHMARK,
      openCount: openInvoices.length,
      agingTotals,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
