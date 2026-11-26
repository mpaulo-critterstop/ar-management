import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
import { FR_OFFICES } from '@/lib/helcimBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const txnId = req.nextUrl.searchParams.get('txn') || '8bbb7025-5b54-4877-b56e-77e7b7e1ea4c';
  const inv = req.nextUrl.searchParams.get('inv') || '286326';

  // 1) the successful txn's full timeline
  const headers = staxHeaders();
  const sg = await fetch(`${STAX_BASE}/transaction/${txnId}`, { headers }).then(r => r.json()).catch(() => null);
  const staxTxn = sg?.id ? { id: sg.id, type: sg.type, total: sg.total, success: sg.success, created_at: sg.created_at, meta: sg.meta } : { error: sg };

  // 2) the ledger row — when was it created (webhook time) vs the invoice creation
  const row = await prisma.staxPayment.findUnique({ where: { staxTransactionId: txnId } });

  // 3) the FR ticket 286326 — its EXACT creation timestamp + current state, in each office
  const ticketInfo: any = {};
  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!(cfg as any).key) continue;
    const auth = `authenticationKey=${(cfg as any).key}&authenticationToken=${(cfg as any).token}`;
    const g = await fetch(`${FR_BASE}/ticket/get?ticketIDs=${inv},${inv}&${auth}`).then(r => r.json()).catch(() => null);
    const tk = g?.tickets?.[0];
    if (tk) ticketInfo[office] = { ticketID: tk.ticketID, dateCreated: tk.dateCreated, dateUpdated: tk.dateUpdated, dateAdded: tk.dateAdded, balance: tk.balance, customerID: tk.customerID, invoiceDate: tk.invoiceDate, active: tk.active };
  }

  return NextResponse.json({
    successfulTxn: staxTxn,
    hubLedger: row ? { status: row.status, failReason: row.failReason, createdAt: row.createdAt, processedAt: row.processedAt, frPaymentId: row.frPaymentId } : null,
    ticket286326: ticketInfo,
  });
}
