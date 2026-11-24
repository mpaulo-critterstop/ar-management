import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (req.nextUrl.searchParams.get('fix') === '1') {
    // the void txn row should NOT be in the recorded/written list — mark it as a non-displayed void marker
    await prisma.staxPayment.update({ where: { staxTransactionId: 'a1f1b729-8612-472b-81e7-c630562866e4' }, data: { status: 'ach_void_marker' } });
    return NextResponse.json({ fixed: true });
  }
  const rows = await prisma.staxPayment.findMany({ where: { frInvoiceNumber: '283138' } });
  return NextResponse.json({ rows: rows.map(r => ({ staxTransactionId: r.staxTransactionId, status: r.status, frPaymentId: r.frPaymentId })), note: 'add &fix=1 to mark the void row non-displayed' });
}
