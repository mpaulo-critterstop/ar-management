import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.staxPayment.findMany({ where: { frInvoiceNumber: '283138' } });
  return NextResponse.json({ rows: rows.map(r => ({ staxTransactionId: r.staxTransactionId, status: r.status, frPaymentId: r.frPaymentId, cardHolderName: r.cardHolderName, amount: r.amount, failReason: r.failReason })) });
}
