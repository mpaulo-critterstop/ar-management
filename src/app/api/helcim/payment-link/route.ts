// Helcim payment links (Option A: Hub-hosted pay page).
//   POST { action:'create', office, invoiceNumber, amount, delivery } → looks up FR invoice, upserts Helcim
//        customer, stores a PaymentLinkRequest, returns the /pay/<token> URL (+ sends email later).
//   POST { action:'initialize', token } → called by the /pay page: creates a HelcimPay.js checkout session
//        for that request and returns the checkoutToken.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const HELCIM_BASE = 'https://api.helcim.com/v2';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const FR: Record<string, { key?: string; token?: string }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW, token: process.env.FIELDROUTES_TOKEN_DFW },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX, token: process.env.FIELDROUTES_TOKEN_ATX },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC, token: process.env.FIELDROUTES_TOKEN_OKC },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT, token: process.env.FIELDROUTES_TOKEN_CSTAT },
};

async function upsertHelcimCustomer(apiToken: string, frCustomerId: string, name: string, email: string, phone: string, billing: any) {
  const headers = { accept: 'application/json', 'api-token': apiToken, 'content-type': 'application/json' };
  // Look for existing by customerCode.
  try {
    const s = await fetch(`${HELCIM_BASE}/customers?search=${encodeURIComponent(frCustomerId)}`, { headers });
    const sj = await s.json();
    const found = Array.isArray(sj) ? sj.find((c: any) => String(c.customerCode) === frCustomerId) : null;
    const body: any = { customerCode: frCustomerId, contactName: name || 'Customer' };
    if (email) body.email = email;
    const ph = (phone || '').replace(/\D/g, ''); if (ph.length >= 10 && ph.length <= 16) body.cellPhone = ph;
    if (name && billing?.street1 && billing?.postalCode) body.billingAddress = { name, street1: billing.street1, city: billing.city, province: billing.state, postalCode: billing.postalCode, country: 'USA', ...(email ? { email } : {}) };
    if (found?.id) { await fetch(`${HELCIM_BASE}/customers/${found.id}`, { method: 'PUT', headers, body: JSON.stringify(body) }); return found.id; }
    const c = await fetch(`${HELCIM_BASE}/customers`, { method: 'POST', headers, body: JSON.stringify(body) });
    const cj = await c.json(); return cj?.id || null;
  } catch { return null; }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const links = await prisma.paymentLinkRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return NextResponse.json({ links: links.map(l => ({ id: l.id, token: l.token, url: `https://hub.critterstop.com/pay/${l.token}`, office: l.office, frInvoiceNumber: l.frInvoiceNumber, customerName: l.customerName, customerEmail: l.customerEmail, amount: l.amount, deliveryMethod: l.deliveryMethod, status: l.status, paidAt: l.paidAt, createdBy: l.createdBy, createdAt: l.createdAt })) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const apiToken = process.env.HELCIM_API_TOKEN;
  if (!apiToken) return NextResponse.json({ error: 'HELCIM_API_TOKEN not set' }, { status: 400 });

  if (b.action === 'create') {
    const office = b.office || 'DFW';
    const fr = FR[office];
    if (!fr?.key) return NextResponse.json({ error: 'bad office' }, { status: 400 });
    const invoiceNumber = String(b.invoiceNumber || '').trim();
    const amount = parseFloat(b.amount);
    if (!invoiceNumber || !amount || amount <= 0) return NextResponse.json({ error: 'invoiceNumber + amount required' }, { status: 400 });

    // Look up the FR invoice -> customer.
    const tr = await fetch(`${FR_BASE}/ticket/get?ticketIDs=${invoiceNumber},${invoiceNumber}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`);
    const tj = await tr.json();
    const tk = (tj.tickets || [])[0];
    if (!tk) return NextResponse.json({ error: `FR invoice ${invoiceNumber} not found` }, { status: 404 });
    const custId = String(tk.customerID);
    const cr = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`);
    const cj = await cr.json();
    const cu = (cj.customers || [])[0];
    const name = cu ? `${cu.fname || ''} ${cu.lname || ''}`.trim() : 'Customer';
    const email = cu?.email || cu?.billingEmail || '';

    // Upsert Helcim customer (returns Helcim internal id for invoice linking).
    const helcimCustomerId = await upsertHelcimCustomer(apiToken, custId, name, email, cu?.phone1 || '', { street1: cu?.billingAddress, city: cu?.billingCity, state: cu?.billingState, postalCode: cu?.billingZip });

    // Create the Helcim invoice carrying the FR invoice number (so the payment comes back matchable to FR).
    // Build it from the FR ticket's breakdown: service charge + items + tax. Idempotent: if it already exists
    // (e.g. a prior link / partial payment), Helcim returns "already existed" — we just reuse that invoiceNumber.
    const hHeaders = { accept: 'application/json', 'api-token': apiToken, 'content-type': 'application/json' };
    const lineItems: any[] = [];
    const svc = parseFloat(tk.serviceCharge || '0');
    if (svc > 0) {
      let svcName = `Service (${tk.serviceID})`;
      try { const str = await fetch(`${FR_BASE}/serviceType/get?serviceTypeIDs=${tk.serviceID},${tk.serviceID}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`); const stj = await str.json(); const st = (stj.serviceTypes || [])[0]; if (st?.description) svcName = st.description; } catch {}
      lineItems.push({ description: svcName, quantity: 1, price: svc, total: svc });
    }
    for (const it of (tk.items || [])) { const a = parseFloat(it.amount || '0'); const q = parseFloat(it.quantity || '1'); lineItems.push({ description: it.description || 'Item', quantity: q, price: a, total: a * q }); }
    const invTax = parseFloat(tk.taxAmount || '0');
    const invBody: any = { invoiceNumber: invoiceNumber, ...(helcimCustomerId ? { customerId: helcimCustomerId } : {}), currency: 'USD', lineItems: lineItems.length ? lineItems : [{ description: 'Service', quantity: 1, price: parseFloat(tk.subTotal || tk.total || '0'), total: parseFloat(tk.subTotal || tk.total || '0') }], ...(invTax > 0 ? { tax: { amount: invTax, details: 'Sales Tax' } } : {}) };
    try { await fetch(`${HELCIM_BASE}/invoices`, { method: 'POST', headers: hHeaders, body: JSON.stringify(invBody) }); } catch {}
    // (If it already existed, that's fine — the invoiceNumber is what matters for the checkout + matching.)

    const token = crypto.randomBytes(8).toString('hex');
    await prisma.paymentLinkRequest.create({
      data: { token, office, frInvoiceNumber: invoiceNumber, frCustomerId: custId, customerName: name, customerEmail: email, amount, helcimCustomerCode: custId, deliveryMethod: b.delivery || 'email', createdBy: (session.user as any)?.name || null },
    });
    const url = `https://hub.critterstop.com/pay/${token}`;
    // (Email sending wired in a later step.)
    return NextResponse.json({ ok: true, url, token, invoice: { customer: name, email, balance: tk.balance, total: tk.total } });
  }

  // Called by the /pay page to start a HelcimPay.js checkout session.
  if (b.action === 'initialize') {
    const plr = await prisma.paymentLinkRequest.findUnique({ where: { token: b.token } });
    if (!plr) return NextResponse.json({ error: 'invalid link' }, { status: 404 });
    if (plr.status === 'paid') return NextResponse.json({ error: 'already paid' }, { status: 409 });
    const payload = {
      paymentType: 'purchase', amount: plr.amount, currency: 'USD',
      customerCode: plr.helcimCustomerCode || plr.frCustomerId,
      invoiceNumber: plr.frInvoiceNumber,
      paymentMethod: 'cc-ach', // allow card or ACH
    };
    const r = await fetch(`${HELCIM_BASE}/helcim-pay/initialize`, { method: 'POST', headers: { accept: 'application/json', 'api-token': apiToken, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j?.checkoutToken) return NextResponse.json({ error: 'could not initialize', detail: j }, { status: 502 });
    await prisma.paymentLinkRequest.update({ where: { id: plr.id }, data: { status: plr.status === 'sent' ? 'viewed' : plr.status } });
    return NextResponse.json({ checkoutToken: j.checkoutToken, amount: plr.amount, customerName: plr.customerName, invoiceNumber: plr.frInvoiceNumber });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
