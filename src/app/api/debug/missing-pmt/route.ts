import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const inv = req.nextUrl.searchParams.get('inv') || '284285';
  const out: any = { invoice: inv, offices: {} };
  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!(cfg as any).key) continue;
    const auth = `authenticationKey=${(cfg as any).key}&authenticationToken=${(cfg as any).token}`;
    // find the ticket, then its payments
    const tg = await fetch(`${FR_BASE}/ticket/get?ticketIDs=${inv},${inv}&${auth}`).then(r => r.json()).catch(() => null);
    const tk = tg?.tickets?.[0];
    if (!tk) continue;
    // payments for this customer around this invoice
    const ps = await fetch(`${FR_BASE}/payment/search?customerIDs=${tk.customerID}&${auth}`).then(r => r.json()).catch(() => null);
    const pids = (ps?.paymentIDs || []).slice(0, 30);
    let payments: any[] = [];
    if (pids.length) { const g = await fetch(`${FR_BASE}/payment/get?paymentIDs=${pids.join(',')}${pids.length===1?','+pids[0]:''}&${auth}`).then(r => r.json()).catch(() => null); payments = g?.payments || []; }
    // payments matching $662.28
    const matches = payments.filter((p:any)=>Math.abs(Number(p.amount)-662.28)<0.01).map((p:any)=>({ id:p.paymentID, amount:p.amount, date:p.date, status:p.status, paymentMethod:p.paymentMethod }));
    out.offices[office] = { ticketFound: true, customerID: tk.customerID, balance: tk.balance, matchingPayments: matches };
  }
  return NextResponse.json(out);
}
