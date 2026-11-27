import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // recent flagged rows with reason mentioning phantom/onsite/reference
  const flagged = await prisma.staxPayment.findMany({
    where: { status: 'flagged' },
    orderBy: { createdAt: 'desc' }, take: 10,
    select: { staxTransactionId: true, amount: true, cardHolderName: true, failReason: true, staxCustomerId: true, source: true, createdAt: true },
  });
  // for any flagged with 'phantom'/'onsite' reason, pull its Stax customer reference
  const headers = staxHeaders();
  const details: any[] = [];
  for (const f of flagged) {
    if (!/phantom|onsite|reference/i.test(f.failReason || '')) continue;
    const t = await fetch(`${STAX_BASE}/transaction/${f.staxTransactionId}`, { headers }).then(r => r.json()).catch(() => null);
    const staxCustId = t?.customer_id || t?.customer?.id || null;
    let custRef = null, custName = null;
    if (staxCustId) {
      const c = await fetch(`${STAX_BASE}/customer/${staxCustId}`, { headers }).then(r => r.json()).catch(() => null);
      custRef = c?.reference; custName = `${c?.firstname||''} ${c?.lastname||''}`.trim();
    }
    details.push({ txn: f.staxTransactionId, amount: f.amount, name: f.cardHolderName, reason: f.failReason, source: f.source, staxCustomerId: staxCustId, staxCustomerReference: custRef, staxCustomerName: custName, meta: t?.meta });
  }
  return NextResponse.json({ recentFlagged: flagged.map(f => ({ txn: f.staxTransactionId, amount: f.amount, name: f.cardHolderName, reason: f.failReason, source: f.source })), phantomDetails: details });
}
