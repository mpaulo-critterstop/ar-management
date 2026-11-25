import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const mStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  // written this month
  const written = await prisma.staxPayment.findMany({ where: { status: 'written', processedAt: { gte: mStart } }, select: { staxTransactionId:true, amount:true, frInvoiceNumber:true, staxType:true } });
  const grossWritten = written.reduce((s,w)=>s+Math.abs(Number(w.amount)||0),0);
  // refund markers among written (these subtract)
  const refundMarkers = written.filter(w => String(w.staxTransactionId).startsWith('refund:') || w.staxType==='refund');
  const refundSum = refundMarkers.reduce((s,w)=>s+Math.abs(Number(w.amount)||0),0);
  // ach_returned this month
  const achRet = await prisma.staxPayment.findMany({ where: { status: 'ach_returned', processedAt: { gte: mStart } }, select: { amount:true, frInvoiceNumber:true } });
  const achSum = achRet.reduce((s,w)=>s+Math.abs(Number(w.amount)||0),0);
  return NextResponse.json({
    grossWrittenThisMonth: Math.round(grossWritten*100)/100,
    refundMarkerCount: refundMarkers.length, refundSum: Math.round(refundSum*100)/100,
    netAfterRefunds: Math.round((grossWritten - refundSum)*100)/100,
    achReturnedThisMonth: { count: achRet.length, sum: Math.round(achSum*100)/100, invoices: achRet.map(a=>a.frInvoiceNumber) },
    note: 'compare netAfterRefunds to Hub UI 284795.39 and Stax 284684.97',
  });
}
