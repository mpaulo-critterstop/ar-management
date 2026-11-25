import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
// Sweep: find Stax transactions this month that are VOIDED/returned but still 'written' (counted) in the Hub.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const headers = staxHeaders();
  const mStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  // scan this month's Stax transactions for voided/returned charges
  const voidedOrReturned: any[] = [];
  for (let page = 1; page <= 30; page++) {
    const r = await fetch(`${STAX_BASE}/transaction?page=${page}&per_page=50`, { headers });
    const j = await r.json().catch(() => null);
    const data = j?.data || [];
    if (!data.length) break;
    let allOld = true;
    for (const t of data) {
      const created = new Date(t.created_at).getTime();
      if (created >= mStart.getTime()) allOld = false;
      const type = String(t.type).toLowerCase();
      if ((type === 'charge' || type === 'capture') && (t.is_voided === true || (t.child_transactions||[]).some((c:any)=>String(c.type).toLowerCase()==='void' && c.success))) {
        voidedOrReturned.push({ id: t.id, total: t.total, created: t.created_at, invoice: t?.meta?.fr_invoice || null, cardHolder: t?.customer?.firstname });
      }
    }
    if (allOld && page > 3) break;
  }
  // which of these are STILL 'written' in the Hub (= still counted)?
  const stuck: any[] = [];
  for (const v of voidedOrReturned) {
    const row = await prisma.staxPayment.findUnique({ where: { staxTransactionId: v.id }, select: { status: true, frPaymentId: true, amount: true, cardHolderName: true, frInvoiceNumber: true } });
    if (row && row.status === 'written') stuck.push({ txn: v.id, amount: row.amount, name: row.cardHolderName, invoice: row.frInvoiceNumber, frPaymentId: row.frPaymentId });
  }
  const stuckTotal = stuck.reduce((s,r)=>s+Math.abs(Number(r.amount)||0),0);
  return NextResponse.json({ voidedOrReturnedFound: voidedOrReturned.length, stillWrittenInHub: stuck.length, stuckTotal: Math.round(stuckTotal*100)/100, stuck });
}
