import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
// Reverse an FR payment that was voided/returned in Stax (ACH return). ?token= &frPaymentId= &office= &confirm=1
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const frPaymentId = sp.get('frPaymentId') || '85308';
  const office = sp.get('office') || 'DFW';
  const cfg = (FR_OFFICES as any)[office];
  if (!cfg) return NextResponse.json({ error: 'bad office' });
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  // read the FR payment first
  const g = await fetch(`${FR_BASE}/payment/get?paymentIDs=${frPaymentId},${frPaymentId}&${auth}`).then(r => r.json()).catch(() => null);
  const pmt = g?.payments?.[0];
  if (sp.get('confirm') !== '1') return NextResponse.json({ dryRun: true, frPayment: pmt ? { id: pmt.paymentID, amount: pmt.amount, status: pmt.status, customerID: pmt.customerID, date: pmt.date } : null, note: 'add &confirm=1 to reverse via createRefund' });
  // reverse it (full refund)
  const r = await fetch(`${FR_BASE}/payment/createRefund?paymentID=${frPaymentId}&${auth}`, { method: 'POST' });
  const j = await r.json().catch(() => null);
  return NextResponse.json({ reversed: j?.success !== false, response: j });
}
