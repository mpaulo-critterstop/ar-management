// CSR (non-PM) pest sales — tracking only, no commission. Serves the /csr-pest-sales module:
//   Tab 1 "Sales": individual CSR-sold pest sales (same shape as the PM pest tracker).
//   Tab 2 "By CSR": one row per CSR — # sold, completed, pending initial, and completed contract value.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const office = sp.get('office');
  const year = sp.get('year') ? Number(sp.get('year')) : null;
  const month = sp.get('month') !== null && sp.get('month') !== undefined && sp.get('month') !== '' ? Number(sp.get('month')) : null; // 0-11, optional

  const where: any = { sellerType: 'csr' };
  if (office && office !== 'All') where.office = office;

  const sales = await prisma.pestSale.findMany({
    where,
    orderBy: [{ saleDate: 'desc' }],
  });

  // Only show sales by CURRENTLY-ACTIVE CSRs (someone who left, like a former rep, drops off the view
  // even if their old sales are still in the table).
  const activeCsrs = await prisma.csrEmployee.findMany({ where: { isCsr: true, active: true }, select: { name: true }, distinct: ['name'] });
  const activeSet = new Set(activeCsrs.map(c => c.name.toLowerCase().trim()));
  const activeSales = sales.filter(s => s.sellerName && activeSet.has(s.sellerName.toLowerCase().trim()));

  // Period scope for the rollup (by sale date). If year given, restrict; if month given too, that month.
  const inPeriod = (s: any) => {
    if (year == null) return true;
    if (!s.saleDate) return false;
    const d = new Date(s.saleDate);
    if (d.getFullYear() !== year) return false;
    if (month != null && d.getMonth() !== month) return false;
    return true;
  };
  const periodSales = activeSales.filter(inPeriod);

  // Per-CSR rollup (scoped to the selected period)
  const byCsr = new Map<string, { csrName: string; sold: number; completed: number; pending: number; completedCV: number }>();
  for (const s of periodSales) {
    const name = s.sellerName || 'Unknown';
    const g = byCsr.get(name) || { csrName: name, sold: 0, completed: 0, pending: 0, completedCV: 0 };
    g.sold += 1;
    if (s.initialDone) { g.completed += 1; g.completedCV += s.contractValue || 0; }
    else { g.pending += 1; }
    byCsr.set(name, g);
  }
  const rollup = [...byCsr.values()].sort((a, b) => b.sold - a.sold);

  // office list for the filter (from all active CSR sales, not period-scoped)
  const offices = [...new Set(activeSales.map(s => s.office))].sort();
  // available years present in the data
  const years = [...new Set(activeSales.filter(s => s.saleDate).map(s => new Date(s.saleDate!).getFullYear()))].sort();

  return NextResponse.json({ sales: activeSales, rollup, offices, years, total: activeSales.length });
}
