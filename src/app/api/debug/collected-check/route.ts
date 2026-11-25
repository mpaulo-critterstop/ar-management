import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Trevor's rows + is the charge still counted anywhere as recorded?
  const trevor = await prisma.staxPayment.findMany({ where: { frInvoiceNumber: '283138' } });
  // any 'written' row with Trevor's amount that would land in recorded?
  return NextResponse.json({ trevorRows: trevor.map(r => ({ staxTransactionId: r.staxTransactionId, status: r.status, amount: r.amount, frPaymentId: r.frPaymentId, processedAt: r.processedAt, createdAt: r.createdAt })) });
}
