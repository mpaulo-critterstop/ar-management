// PUBLIC endpoint (no login) — the /pay/<token> page calls this to start a HelcimPay.js checkout session.
// Only exposes what the pay page needs; the token is the unguessable secret. Creates no FR/customer data.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
const HELCIM_BASE = 'https://api.helcim.com/v2';

export async function POST(req: NextRequest) {
  const b = await req.json();
  const apiToken = process.env.HELCIM_API_TOKEN;
  if (!apiToken) return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  if (!b.token) return NextResponse.json({ error: 'invalid link' }, { status: 400 });

  const plr = await prisma.paymentLinkRequest.findUnique({ where: { token: b.token } });
  if (!plr) return NextResponse.json({ error: 'invalid link' }, { status: 404 });
  if (plr.status === 'paid') return NextResponse.json({ error: 'already paid' }, { status: 409 });

  const payload = {
    paymentType: 'purchase', amount: plr.amount, currency: 'USD',
    customerCode: plr.helcimCustomerCode || plr.frCustomerId,
    invoiceNumber: plr.frInvoiceNumber,
    paymentMethod: 'cc-ach',
  };
  const r = await fetch(`${HELCIM_BASE}/helcim-pay/initialize`, { method: 'POST', headers: { accept: 'application/json', 'api-token': apiToken, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json();
  if (!j?.checkoutToken) return NextResponse.json({ error: 'could not start payment' }, { status: 502 });

  if (plr.status === 'sent') await prisma.paymentLinkRequest.update({ where: { id: plr.id }, data: { status: 'viewed' } });
  return NextResponse.json({ checkoutToken: j.checkoutToken, amount: plr.amount, customerName: plr.customerName, invoiceNumber: plr.frInvoiceNumber });
}
