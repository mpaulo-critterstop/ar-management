// Serves pest sales from the pest_sales table for the tracker UI.
//   /api/pest-sales?office=DFW&pm=All&category=All
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
  const pm = sp.get('pm');
  const category = sp.get('category');

  const where: any = { sellerType: 'pm' }; // PM module shows PM sales only; CSR sales live in /csr-pest-sales
  if (office && office !== 'All') where.office = office;
  if (pm && pm !== 'All') where.pmName = pm;
  if (category && category !== 'All') where.category = category;

  const sales = await prisma.pestSale.findMany({
    where,
    orderBy: [{ saleDate: 'desc' }],
    take: 2000,
  });

  const pmNames = [...new Set(sales.map(s => s.pmName).filter(Boolean))].sort();
  const totals = {
    count: sales.length,
    contractValue: sales.reduce((s, r) => s + (r.contractValue || 0), 0),
    done: sales.filter(s => s.initialDone).length,
    pending: sales.filter(s => !s.initialDone).length,
  };

  return NextResponse.json({ sales, pmNames, totals });
}
