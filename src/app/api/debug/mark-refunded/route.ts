// TEMP one-shot: mark a Stax payment as refunded in the Hub ledger when it was refunded OUTSIDE the Hub
// (directly in FR/Stax), so the Payment Report moves it from Recorded -> Refunded.
// GET ?token=critterstop2026&txn=<staxTransactionId>
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const txn = String(req.nextUrl.searchParams.get('txn') || '').trim();
  if (!txn) return NextResponse.json({ error: 'txn required' }, { status: 400 });

  const orig = await prisma.staxPayment.findUnique({ where: { staxTransactionId: txn } });
  if (!orig) return NextResponse.json({ error: 'txn not found in ledger' }, { status: 404 });

  // Create a refund marker (id = refund:<origId>) — the report reads these to classify the original as refunded.
  const markerId = `refund:${txn}`;
  await prisma.staxPayment.upsert({
    where: { staxTransactionId: markerId },
    create: { staxTransactionId: markerId, amount: -(orig.amount || 0), staxType: 'refund', status: 'written', frInvoiceNumber: orig.frInvoiceNumber, source: 'manual-external-refund', processedAt: new Date() },
    update: { status: 'written' },
  });
  return NextResponse.json({ ok: true, marked: txn, markerId });
}
