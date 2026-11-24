import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cfg = (FR_OFFICES as any).DFW;
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  // get payment 85978 detail — is it linked to ticket 284285?
  const pg = await fetch(`${FR_BASE}/payment/get?paymentIDs=85978,85978&${auth}`).then(r => r.json()).catch(() => null);
  const p = pg?.payments?.[0];
  // fix: mark the Hub claimed row as written with this frPaymentId
  if (sp.get('fix') === '1') {
    await prisma.staxPayment.update({ where: { staxTransactionId: 'a123bc79-9651-48ee-bb33-abe1f4ed2e8f' }, data: { status: 'written', frPaymentId: '85978', office: 'DFW', processedAt: new Date(), failReason: null } });
    return NextResponse.json({ fixed: true, markedWritten: '85978' });
  }
  return NextResponse.json({ payment85978: p ? { id: p.paymentID, amount: p.amount, date: p.date, status: p.status, ticketID: p.ticketID, appliedTo: p.appliedPayments || p.tickets || null, customerID: p.customerID } : 'not found', note: 'add &fix=1 to mark Hub row written w/ 85978' });
}
