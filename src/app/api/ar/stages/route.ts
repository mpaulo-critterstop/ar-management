// AR escalation stages — invoices moved off the call sheet into Collections / SCC / Bad Debt.
// GET /api/ar/stages[?office=DFW]  -> { items: [{customer, service, outstanding, status, ...}] }
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';

const WILDLIFE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'ar')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const office = req.nextUrl.searchParams.get('office');
  const noFilter = !office || office === 'All' || office === 'ALL' || office === 'all';

  const invoices = await prisma.invoice.findMany({
    where: {
      arStage: { not: null },
      status: { not: 'PAID' },
      ...(noFilter ? {} : { office: { equals: office!, mode: 'insensitive' } }),
    },
    select: {
      id: true, customerId: true, serviceType: true, serviceId: true, amount: true, paid: true,
      office: true, arStage: true, arStageAt: true, arNote: true,
      customer: { select: { name: true, serviceAddr: true } },
    },
    orderBy: { arStageAt: 'desc' },
  });

  const items = invoices
    .filter(i => Number(i.paid) < Number(i.amount)) // safety: drop anything fully paid
    .map(i => ({
    invoiceId: i.id,
    customerId: i.customerId,
    customerName: i.customer?.name || '—',
    serviceAddr: i.customer?.serviceAddr || '',
    serviceType: i.serviceType,
    serviceCategory: WILDLIFE_IDS.includes(Number(i.serviceId)) ? 'Wildlife' : 'Pest Control',
    office: i.office,
    outstanding: Number(i.amount) - Number(i.paid),
    status: i.arStage,
    stagedAt: i.arStageAt,
    arNote: i.arNote || '',
  }));

  return NextResponse.json({ count: items.length, items });
}
