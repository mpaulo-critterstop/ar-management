import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cfg = (FR_OFFICES as any).DFW;
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  // ticket 284285 current balance + all its payments
  const tg = await fetch(`${FR_BASE}/ticket/get?ticketIDs=284285,284285&${auth}`).then(r => r.json()).catch(() => null);
  const tk = tg?.tickets?.[0];
  // all payments for customer 53100, show dates + amounts to see if 85978 is the only $662.28 or there are dupes
  const ps = await fetch(`${FR_BASE}/payment/search?customerIDs=53100&${auth}`).then(r => r.json()).catch(() => null);
  const pids = ps?.paymentIDs || [];
  let payments: any[] = [];
  if (pids.length) { const g = await fetch(`${FR_BASE}/payment/get?paymentIDs=${pids.join(',')}&${auth}`).then(r => r.json()).catch(() => null); payments = (g?.payments||[]).map((p:any)=>({id:p.paymentID,amount:p.amount,date:p.date,status:p.status})); }
  return NextResponse.json({ ticket284285: tk ? { balance: tk.balance, total: tk.total, customerID: tk.customerID } : null, allCustomerPayments: payments.sort((a,b)=>String(b.date).localeCompare(String(a.date))) });
}
