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

  const where: any = { sellerType: 'csr' };
  if (office && office !== 'All') where.office = office;

  const sales = await prisma.pestSale.findMany({
    where,
    orderBy: [{ saleDate: 'desc' }],
  });

  // Per-CSR rollup
  const byCsr = new Map<string, { csrName: string; sold: number; completed: number; pending: number; completedCV: number }>();
  for (const s of sales) {
    const name = s.sellerName || 'Unknown';
    const g = byCsr.get(name) || { csrName: name, sold: 0, completed: 0, pending: 0, completedCV: 0 };
    g.sold += 1;
    if (s.initialDone) { g.completed += 1; g.completedCV += s.contractValue || 0; }
    else { g.pending += 1; }
    byCsr.set(name, g);
  }
  const rollup = [...byCsr.values()].sort((a, b) => b.sold - a.sold);

  // office list for the filter
  const offices = [...new Set(sales.map(s => s.office))].sort();

  return NextResponse.json({ sales, rollup, offices, total: sales.length });
}
