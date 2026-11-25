import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const mStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  // EXACTLY what the status endpoint returns as 'recorded' this month — does Trevor appear?
  const written = await prisma.staxPayment.findMany({ where: { status: 'written' }, orderBy: { processedAt: 'desc' }, take: 1000, select: { staxTransactionId:true, amount:true, cardHolderName:true, frInvoiceNumber:true, processedAt:true, staxType:true } });
  // the status route filters out refund markers (isRefundMarker) from 'recorded'
  const isRefundMarker = (r:any)=> String(r.staxTransactionId).startsWith('refund:') || r.staxType==='refund';
  const realWritten = written.filter(r=>!isRefundMarker(r));
  const thisMonth = realWritten.filter(r=>{const d=new Date(r.processedAt as any).getTime(); return !isNaN(d) && d>=mStart.getTime();});
  const total = thisMonth.reduce((s,r)=>s+Math.abs(Number(r.amount)||0),0);
  // any Trevor / inv 283138 in the recorded set?
  const trevor = thisMonth.filter(r=>r.frInvoiceNumber==='283138');
  return NextResponse.json({ recordedThisMonthCount: thisMonth.length, collectedMTD: Math.round(total*100)/100, trevorInRecorded: trevor });
}
