import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (sp.get('fix') === '1') {
    await prisma.staxPayment.update({ where: { staxTransactionId: 'a123bc79-9651-48ee-bb33-abe1f4ed2e8f' }, data: { status: 'written', frPaymentId: '85978', office: 'DFW', processedAt: new Date(), failReason: null } });
    const after = await prisma.staxPayment.findUnique({ where: { staxTransactionId: 'a123bc79-9651-48ee-bb33-abe1f4ed2e8f' }, select: { status: true, frPaymentId: true } });
    return NextResponse.json({ fixed: true, after });
  }
  return NextResponse.json({ note: 'add &fix=1 to mark written w/ FR payment 85978 (confirmed FR has exactly one $662.28 payment on cust 53100)' });
}
