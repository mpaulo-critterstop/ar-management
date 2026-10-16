import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // REPAIR: charge rows whose staxType got clobbered to 'refund' by the void-id-collision bug. A real charge
  // has a non-'refund:' id AND an frPaymentId AND positive amount. Restore staxType to 'charge'.
  if (sp.get('repair') === '1') {
    const candidates = await prisma.staxPayment.findMany({
      where: { staxType: 'refund', amount: { gt: 0 }, frPaymentId: { not: null } },
      select: { id: true, staxTransactionId: true },
    });
    const toFix = candidates.filter(r => !String(r.staxTransactionId).startsWith('refund:'));
    for (const r of toFix) await prisma.staxPayment.update({ where: { id: r.id }, data: { staxType: 'charge' } }).catch(() => {});
    return NextResponse.json({ repaired: toFix.length, ids: toFix.map(r => r.staxTransactionId) });
  }

  const rows = await prisma.staxPayment.findMany({
    orderBy: { createdAt: 'desc' }, take: 30,
    select: { staxTransactionId: true, amount: true, status: true, staxType: true, source: true, frInvoiceNumber: true, frPaymentId: true },
  });
  return NextResponse.json({ count: rows.length, rows });
}
