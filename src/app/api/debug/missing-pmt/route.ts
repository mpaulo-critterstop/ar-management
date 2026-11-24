import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (req.nextUrl.searchParams.get('fix') === '1') {
    const r = await prisma.staxPayment.update({ where: { staxTransactionId: 'a123bc79-9651-48ee-bb33-abe1f4ed2e8f' }, data: { status: 'written', frPaymentId: '85978', office: 'DFW', processedAt: new Date(), failReason: null } });
    return NextResponse.json({ fixed: true, status: r.status, frPaymentId: r.frPaymentId });
  }
  const r = await prisma.staxPayment.findUnique({ where: { staxTransactionId: 'a123bc79-9651-48ee-bb33-abe1f4ed2e8f' } });
  return NextResponse.json({ current: r ? { status: r.status, frPaymentId: r.frPaymentId } : null });
}
