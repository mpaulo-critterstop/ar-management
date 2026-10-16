import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.staxPayment.findMany({
    orderBy: { createdAt: 'desc' }, take: 30,
    select: { staxTransactionId: true, amount: true, status: true, staxType: true, source: true, frInvoiceNumber: true, frPaymentId: true },
  });
  return NextResponse.json({ count: rows.length, rows });
}
