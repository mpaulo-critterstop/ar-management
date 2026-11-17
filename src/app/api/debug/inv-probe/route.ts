import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const inv = req.nextUrl.searchParams.get('inv') || '281517';
  const out: any = { invoice: inv, offices: {} };
  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!cfg.key) { out.offices[office] = 'no creds'; continue; }
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    try {
      // try ticket/get (the current method)
      const g = await fetch(`${FR_BASE}/ticket/get?ticketIDs=${inv},${inv}&${auth}`);
      const gj = await g.json().catch(() => null);
      const tk = (gj?.tickets || [])[0];
      // also try ticket/search by ticketID
      const s = await fetch(`${FR_BASE}/ticket/search?ticketID=${encodeURIComponent(JSON.stringify({ operator: '=', value: inv }))}&${auth}`);
      const sj = await s.json().catch(() => null);
      out.offices[office] = {
        ticketGet: tk ? { ticketID: tk.ticketID, customerID: tk.customerID, balance: tk.balance, total: tk.total } : (gj?.error ? { error: gj.error } : 'no ticket'),
        ticketSearchIDs: sj?.ticketIDs || sj?.error || 'none',
      };
    } catch (e) { out.offices[office] = { error: String(e) }; }
  }
  return NextResponse.json(out);
}
