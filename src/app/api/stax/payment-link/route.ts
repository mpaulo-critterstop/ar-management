// Stax payment-link API — the CSR tool. GET lists recent links; POST action:'create' looks up the FR invoice,
// creates a Stax customer + invoice tagged with the FR invoice number (so the webhook records the payment back
// to FR automatically), gets the hosted pay URL, stores a PaymentLinkRequest, and delivers via email/SMS.
//
// Simpler than Helcim: Stax HOSTS the payment page (no custom /pay page or initialize step needed). Customer
// pays on Stax's page → create_transaction webhook → staxBridge → recorded to the FR invoice.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { sendPaymentLinkEmail } from '@/lib/email';
import { sendPaymentLinkSms } from '@/lib/sms';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';

export const dynamic = 'force-dynamic';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const FR: Record<string, { key?: string; token?: string }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW, token: process.env.FIELDROUTES_TOKEN_DFW },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX, token: process.env.FIELDROUTES_TOKEN_ATX },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC, token: process.env.FIELDROUTES_TOKEN_OKC },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT, token: process.env.FIELDROUTES_TOKEN_CSTAT },
};

async function sx(path: string, method = 'GET', body?: any) {
  const r = await fetch(`${STAX_BASE}${path}`, { method, headers: staxHeaders(), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { ok: r.ok, status: r.status, json };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const links = await prisma.paymentLinkRequest.findMany({ where: { processor: 'stax' } as any, orderBy: { createdAt: 'desc' }, take: 100 }).catch(() => [] as any[]);
  return NextResponse.json({
    links: links.map((l: any) => ({
      id: l.id, token: l.token, url: l.payUrl || `https://hub.critterstop.com/pay/${l.token}`,
      office: l.office, frInvoiceNumber: l.frInvoiceNumber, customerName: l.customerName,
      customerEmail: l.customerEmail, amount: l.amount, deliveryMethod: l.deliveryMethod,
      status: l.status, paidAt: l.paidAt, createdBy: l.createdBy, createdAt: l.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.STAX_API_KEY) return NextResponse.json({ error: 'STAX_API_KEY not set' }, { status: 500 });
  const b = await req.json();

  if (b.action !== 'create') return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const office = b.office || 'DFW';
  const fr = FR[office];
  if (!fr?.key) return NextResponse.json({ error: `no FR creds for ${office}` }, { status: 400 });
  const invoiceNumber = String(b.invoiceNumber || '').trim();
  const amount = parseFloat(b.amount);
  if (!invoiceNumber || !amount || amount <= 0) return NextResponse.json({ error: 'invoiceNumber + amount required' }, { status: 400 });
  const delivery = b.delivery || 'email';

  // 1) Look up the FR invoice → customer.
  const tr = await fetch(`${FR_BASE}/ticket/get?ticketIDs=${invoiceNumber},${invoiceNumber}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`);
  const tj = await tr.json();
  const tk = (tj.tickets || [])[0];
  if (!tk) return NextResponse.json({ error: `FR invoice ${invoiceNumber} not found` }, { status: 404 });
  const custId = String(tk.customerID);
  const cr = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`);
  const cj = await cr.json();
  const cu = (cj.customers || [])[0] || {};
  const name = `${cu.fname || ''} ${cu.lname || ''}`.trim() || cu.companyName || 'Customer';
  const email = cu.email || cu.billingEmail || '';
  const phone = cu.phone1 || cu.phone2 || '';

  // 2) Create (or reuse) a Stax customer.
  const [firstname, ...rest] = name.split(' ');
  const custRes = await sx('/customer', 'POST', {
    firstname: firstname || name, lastname: rest.join(' ') || '-', email: email || undefined,
    phone: phone || undefined, reference: `FR-${custId}`,
  });
  const staxCustomerId = custRes.json?.id;
  if (!staxCustomerId) return NextResponse.json({ error: 'could not create Stax customer', detail: custRes.json }, { status: 502 });

  // 3) Create a Stax INVOICE tagged with the FR invoice number (meta.fr_invoice), partial payments enabled so
  //    CSR can collect any amount (deposits / 50-50). Stax gives it a hosted pay URL.
  const token = crypto.randomBytes(8).toString('hex');
  const invRes = await sx('/invoice', 'POST', {
    customer_id: staxCustomerId,
    total: amount,
    url: `hub-${token}`, // merchant-side reference slug
    meta: { fr_invoice: invoiceNumber, memo: `Critter Stop invoice #${invoiceNumber}`, reference: invoiceNumber },
    is_partial_payment_enabled: true,
  });
  if (!invRes.ok || !invRes.json?.id) return NextResponse.json({ error: 'could not create Stax invoice', detail: invRes.json }, { status: 502 });
  const staxInvoiceId = invRes.json.id;

  // The hosted payment URL: Stax invoices are payable at app.staxpayments.com/#/pay-invoice/<id> (or the
  // payment_link_url the API returns). Prefer whatever the API returns; fall back to the standard pattern.
  const payUrl = invRes.json.payment_link_url || invRes.json.url || `https://app.staxpayments.com/#/pay-invoice/${staxInvoiceId}`;

  // 4) Store a PaymentLinkRequest row (processor=stax) for tracking.
  await prisma.paymentLinkRequest.create({
    data: {
      token, office, frInvoiceNumber: invoiceNumber, frCustomerId: custId, customerName: name,
      customerEmail: email, amount, helcimCustomerCode: staxCustomerId, deliveryMethod: delivery,
      createdBy: (session.user as any)?.name || null,
      ...( { processor: 'stax', payUrl, staxInvoiceId } as any ),
    } as any,
  }).catch(async () => {
    // if the new columns don't exist yet, store without them (graceful)
    await prisma.paymentLinkRequest.create({ data: { token, office, frInvoiceNumber: invoiceNumber, frCustomerId: custId, customerName: name, customerEmail: email, amount, helcimCustomerCode: staxCustomerId, deliveryMethod: delivery, createdBy: (session.user as any)?.name || null } }).catch(() => {});
  });

  // 5) Deliver via email or SMS (reuse existing helpers; they take the URL).
  let sendResult: any = { sent: false, reason: 'not requested' };
  if (delivery === 'email') sendResult = await sendPaymentLinkEmail({ to: email, customerName: name, amount, invoiceNumber, url: payUrl });
  else if (delivery === 'text') sendResult = await sendPaymentLinkSms({ to: phone, customerName: name, amount, invoiceNumber, url: payUrl });
  // Optionally Stax can also send the invoice natively (email/SMS) — we use our own branded delivery instead.

  return NextResponse.json({
    ok: true, url: payUrl, token, delivery, sent: sendResult.sent, sendReason: sendResult.reason,
    staxInvoiceId, invoice: { customer: name, email, phone, balance: tk.balance, total: tk.total },
  });
}
