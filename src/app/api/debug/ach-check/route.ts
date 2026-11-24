import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // mark the original charge ledger row as ach_returned, and the void row as written
  if (sp.get('confirm') === '1') {
    await prisma.staxPayment.update({ where: { staxTransactionId: '91f5597e-3edc-46e2-b031-256c21cebe7a' }, data: { status: 'ach_returned', failReason: 'ACH return R03 — No Account; FR payment 85308 reversed via refund 85986', processedAt: new Date() } }).catch(()=>{});
    await prisma.staxPayment.update({ where: { staxTransactionId: 'a1f1b729-8612-472b-81e7-c630562866e4' }, data: { status: 'written', failReason: 'void processed; reversed FR payment 85308', processedAt: new Date() } }).catch(()=>{});
    return NextResponse.json({ ok: true, updated: 'charge->ach_returned, void->written' });
  }
  const rows = await prisma.staxPayment.findMany({ where: { frInvoiceNumber: '283138' } });
  return NextResponse.json({ rows: rows.map(r=>({ staxTransactionId:r.staxTransactionId, status:r.status, frPaymentId:r.frPaymentId })) , note:'add &confirm=1 to update ledger'});
}
