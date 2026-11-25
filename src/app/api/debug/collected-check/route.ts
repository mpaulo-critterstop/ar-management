import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // replicate the 'Collected this month' calc: written rows processed this month
  const mStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const written = await prisma.staxPayment.findMany({ where: { status: 'written', processedAt: { gte: mStart } }, select: { staxTransactionId: true, amount: true, cardHolderName: true, frInvoiceNumber: true, processedAt: true } });
  // is Trevor's charge (now ach_returned) in here? No. But is there a DIFFERENT written row for 283138?
  const trevorInWritten = written.filter(w => w.frInvoiceNumber === '283138' || Math.abs((w.amount||0)-110.42)<0.01);
  const total = written.reduce((s,w)=>s+Math.abs(Number(w.amount)||0),0);
  return NextResponse.json({ monthStart: mStart.toISOString(), writtenThisMonthCount: written.length, collectedMTD: Math.round(total*100)/100, trevorOrMatchingAmountInWritten: trevorInWritten });
}
