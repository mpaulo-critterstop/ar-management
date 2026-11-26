import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // find ALL rows whose failReason mentions invoice not found / cannot be found (any status, last 30 days)
  const since = new Date(Date.now() - 30 * 86400000);
  const rows = await prisma.staxPayment.findMany({
    where: {
      createdAt: { gte: since },
      OR: [
        { failReason: { contains: 'invoice', mode: 'insensitive' } },
        { failReason: { contains: 'not found', mode: 'insensitive' } },
        { failReason: { contains: 'cannot be found', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' }, take: 50,
    select: { staxTransactionId: true, frInvoiceNumber: true, amount: true, cardHolderName: true, status: true, failReason: true, createdAt: true },
  });
  // group by reason text
  const byReason: Record<string, number> = {};
  for (const r of rows) { const k = (r.failReason || '').slice(0, 50); byReason[k] = (byReason[k] || 0) + 1; }
  return NextResponse.json({ matchCount: rows.length, byReason, rows: rows.map(r => ({ txn: r.staxTransactionId, inv: r.frInvoiceNumber, name: r.cardHolderName, amount: r.amount, status: r.status, reason: r.failReason, when: r.createdAt })) });
}
