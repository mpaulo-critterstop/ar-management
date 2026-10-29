// TEMP debug: classify a list of invoice externalIds as wildlife vs non-wildlife + show office.
// GET ?token=critterstop2026&ids=267035,270136,...
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
const WILD = new Set([553,716,720,501,674,479,541,542,624,510]);
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const ids = (req.nextUrl.searchParams.get('ids') || '').split(',').filter(Boolean);
  const invs = await prisma.invoice.findMany({
    where: { externalId: { in: ids } },
    select: { externalId: true, serviceId: true, office: true, amount: true, paid: true, arFollowupSent: true, customer: { select: { name: true } } },
  });
  const out = invs.map(i => ({
    invoice: i.externalId, customer: i.customer?.name, serviceId: i.serviceId, office: i.office,
    flow: WILD.has(Number(i.serviceId)) ? 'wildlife' : 'non-wildlife',
    amount: Number(i.amount), paid: Number(i.paid), stillEnrolled: i.arFollowupSent,
  }));
  return NextResponse.json({ count: out.length, invoices: out });
}
