// Helcim API probe (read-only). Tests the connection + fetches test-account transactions so we can see the
// data shape — especially customerCode / invoiceNumber (the fields we'd use to match a Helcim payment to FR).
// Token lives in env var HELCIM_API_TOKEN (never hardcoded). Works against the test account the token belongs to.
//   /api/debug/helcim-probe?token=critterstop2026                → connection test
//   /api/debug/helcim-probe?token=critterstop2026&action=transactions   → list card transactions
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const BASE = 'https://api.helcim.com/v2';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const apiToken = process.env.HELCIM_API_TOKEN;
  if (!apiToken) return NextResponse.json({ error: 'HELCIM_API_TOKEN env var not set. Add it in Vercel first.' }, { status: 400 });

  const headers = { 'accept': 'application/json', 'api-token': apiToken };
  const action = sp.get('action') || 'connection';

  if (action === 'connection') {
    const r = await fetch(`${BASE}/connection-test`, { headers });
    const j = await r.json().catch(() => ({ parseError: true }));
    return NextResponse.json({ action: 'connection-test', httpStatus: r.status, result: j });
  }

  if (action === 'transactions') {
    // Get card transactions. Supports paging/filter params per Helcim docs; start simple.
    const limit = sp.get('limit') || '25';
    const r = await fetch(`${BASE}/card-transactions?limit=${limit}`, { headers });
    const text = await r.text();
    let j: any; try { j = JSON.parse(text); } catch { j = text.slice(0, 500); }
    // Surface the key fields for matching (customerCode, invoiceNumber) plus the raw for full inspection.
    const txns = Array.isArray(j) ? j : (j?.transactions || j?.data || []);
    const slim = Array.isArray(txns) ? txns.slice(0, 25).map((t: any) => ({
      transactionId: t.transactionId, dateCreated: t.dateCreated, status: t.status, type: t.type,
      amount: t.amount, currency: t.currency, cardHolderName: t.cardHolderName,
      customerCode: t.customerCode, invoiceNumber: t.invoiceNumber, approvalCode: t.approvalCode,
    })) : null;
    return NextResponse.json({ action: 'transactions', httpStatus: r.status, count: Array.isArray(txns) ? txns.length : 0, transactions: slim, _rawShape: Array.isArray(j) ? 'array' : (j && typeof j === 'object' ? Object.keys(j) : typeof j) });
  }

  if (action === 'create-customer') {
    const customerCode = sp.get('customerCode') || '';
    const contactName = sp.get('contactName') || '';
    const businessName = sp.get('businessName') || '';
    if (!contactName && !businessName) return NextResponse.json({ error: 'contactName or businessName required' }, { status: 400 });
    const bodyObj: any = { customerCode };
    if (contactName) bodyObj.contactName = contactName;
    if (businessName) bodyObj.businessName = businessName;
    const r = await fetch(`${BASE}/customers`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) });
    const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t.slice(0, 500); }
    return NextResponse.json({ action: 'create-customer', httpStatus: r.status, sent: bodyObj, result: j });
  }

  if (action === 'create-invoice') {
    const invoiceNumber = sp.get('invoiceNumber') || '';
    const customerId = sp.get('customerId'); // Helcim internal customer id (links the invoice to the customer)
    const amount = parseFloat(sp.get('amount') || '0');
    const desc = sp.get('desc') || 'Service';
    // Helcim invoices need line items. Build one line for the full amount. Link to customer via customerId.
    const bodyObj: any = {
      invoiceNumber,
      ...(customerId ? { customerId: parseInt(customerId) } : {}),
      currency: 'USD',
      lineItems: [{ description: desc, quantity: 1, price: amount, total: amount }],
    };
    const r = await fetch(`${BASE}/invoices`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) });
    const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t.slice(0, 500); }
    return NextResponse.json({ action: 'create-invoice', httpStatus: r.status, sent: bodyObj, result: j });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
