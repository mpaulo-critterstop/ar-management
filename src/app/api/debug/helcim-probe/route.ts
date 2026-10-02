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
    const email = sp.get('email') || '';
    const cellPhone = (sp.get('cellPhone') || '').replace(/\D/g, '');
    // billing address (Helcim requires name + street1 + postalCode for a valid billingAddress)
    const street1 = sp.get('street1') || '';
    const city = sp.get('city') || '';
    const province = sp.get('state') || '';
    const postalCode = sp.get('zip') || '';
    if (!contactName && !businessName) return NextResponse.json({ error: 'contactName or businessName required' }, { status: 400 });
    const bodyObj: any = { customerCode };
    if (contactName) bodyObj.contactName = contactName;
    if (businessName) bodyObj.businessName = businessName;
    if (email) bodyObj.email = email;
    if (cellPhone && cellPhone.length >= 10 && cellPhone.length <= 16) bodyObj.cellPhone = cellPhone;
    // Only send billingAddress if we have the minimum required fields (name + street1 + postalCode).
    const billName = contactName || businessName;
    if (billName && street1 && postalCode) {
      bodyObj.billingAddress = { name: billName, street1, ...(city ? { city } : {}), ...(province ? { province } : {}), postalCode, country: 'USA', ...(email ? { email } : {}), ...(cellPhone ? { phone: cellPhone } : {}) };
    }
    const r = await fetch(`${BASE}/customers`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) });
    const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t.slice(0, 500); }
    return NextResponse.json({ action: 'create-customer', httpStatus: r.status, sent: bodyObj, result: j });
  }

  if (action === 'update-customer') {
    const helcimCustomerId = sp.get('helcimCustomerId');
    if (!helcimCustomerId) return NextResponse.json({ error: 'helcimCustomerId required' }, { status: 400 });
    const contactName = sp.get('contactName') || '';
    const businessName = sp.get('businessName') || '';
    const email = sp.get('email') || '';
    const cellPhone = (sp.get('cellPhone') || '').replace(/\D/g, '');
    const street1 = sp.get('street1') || '';
    const city = sp.get('city') || '';
    const province = sp.get('state') || '';
    const postalCode = sp.get('zip') || '';
    const bodyObj: any = {};
    if (contactName) bodyObj.contactName = contactName;
    if (businessName) bodyObj.businessName = businessName;
    if (email) bodyObj.email = email;
    if (cellPhone && cellPhone.length >= 10 && cellPhone.length <= 16) bodyObj.cellPhone = cellPhone;
    const billName = contactName || businessName;
    if (billName && street1 && postalCode) {
      bodyObj.billingAddress = { name: billName, street1, ...(city ? { city } : {}), ...(province ? { province } : {}), postalCode, country: 'USA', ...(email ? { email } : {}), ...(cellPhone ? { phone: cellPhone } : {}) };
    }
    const r = await fetch(`${BASE}/customers/${helcimCustomerId}`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) });
    const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t.slice(0, 500); }
    return NextResponse.json({ action: 'update-customer', httpStatus: r.status, sent: bodyObj, result: j });
  }

  // Build a complete Helcim invoice from an FR ticket: all line items (service charge + products) + total tax.
  if (action === 'create-invoice-from-fr') {
    const ticketId = sp.get('ticket');
    const customerId = sp.get('customerId');
    const office = sp.get('office') || 'DFW';
    if (!ticketId) return NextResponse.json({ error: 'ticket required' }, { status: 400 });
    const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
    const FR: Record<string, { key?: string; token?: string }> = {
      DFW: { key: process.env.FIELDROUTES_KEY_DFW, token: process.env.FIELDROUTES_TOKEN_DFW },
      ATX: { key: process.env.FIELDROUTES_KEY_ATX, token: process.env.FIELDROUTES_TOKEN_ATX },
      OKC: { key: process.env.FIELDROUTES_KEY_OKC, token: process.env.FIELDROUTES_TOKEN_OKC },
      CStat: { key: process.env.FIELDROUTES_KEY_CSTAT, token: process.env.FIELDROUTES_TOKEN_CSTAT },
    };
    const fr = FR[office];
    if (!fr?.key) return NextResponse.json({ error: 'bad office' }, { status: 400 });
    // Read the FR ticket.
    const tr = await fetch(`${FR_BASE}/ticket/get?ticketIDs=${ticketId},${ticketId}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`);
    const tj = await tr.json();
    const tk = (tj.tickets || [])[0];
    if (!tk) return NextResponse.json({ error: 'FR ticket not found' }, { status: 404 });

    // Build line items: base service charge (if > 0) + each product item.
    const lineItems: any[] = [];
    const svc = parseFloat(tk.serviceCharge || '0');
    if (svc > 0) {
      // Resolve the serviceID to its real name (e.g. 553 -> "Exclusion") from FR's service type reference.
      let svcName = `Service (${tk.serviceID})`;
      try {
        const str = await fetch(`${FR_BASE}/serviceType/get?serviceTypeIDs=${tk.serviceID},${tk.serviceID}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`);
        const stj = await str.json();
        const st = (stj.serviceTypes || [])[0];
        if (st?.description) svcName = st.description;
      } catch { /* fall back to placeholder */ }
      lineItems.push({ description: svcName, quantity: 1, price: svc, total: svc });
    }
    for (const it of (tk.items || [])) {
      const amt = parseFloat(it.amount || '0');
      lineItems.push({ description: it.description || 'Item', quantity: parseFloat(it.quantity || '1'), price: amt, total: amt * parseFloat(it.quantity || '1') });
    }
    const taxAmount = parseFloat(tk.taxAmount || '0');
    const bodyObj: any = {
      invoiceNumber: String(tk.ticketID),
      ...(customerId ? { customerId: parseInt(customerId) } : {}),
      currency: 'USD',
      lineItems,
      ...(taxAmount > 0 ? { tax: { amount: taxAmount, details: 'Sales Tax' } } : {}),
    };
    const r = await fetch(`${BASE}/invoices`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) });
    const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t.slice(0, 500); }
    return NextResponse.json({ action: 'create-invoice-from-fr', httpStatus: r.status, frSubTotal: tk.subTotal, frTax: tk.taxAmount, frTotal: tk.total, sent: bodyObj, result: j });
  }

  if (action === 'create-invoice') {
    const invoiceNumber = sp.get('invoiceNumber') || '';
    const customerId = sp.get('customerId'); // Helcim internal customer id (links the invoice to the customer)
    const subTotal = parseFloat(sp.get('subTotal') || sp.get('amount') || '0'); // pre-tax
    const taxAmount = parseFloat(sp.get('taxAmount') || '0');
    const desc = sp.get('desc') || 'Service';
    // Push the FR breakdown: line item = pre-tax subtotal, tax as a separate amount. This keeps records accurate
    // AND helps qualify for Level 2/3 interchange (cheaper) which needs tax + itemized data.
    const bodyObj: any = {
      invoiceNumber,
      ...(customerId ? { customerId: parseInt(customerId) } : {}),
      currency: 'USD',
      lineItems: [{ description: desc, quantity: 1, price: subTotal, total: subTotal }],
      ...(taxAmount > 0 ? { tax: { amount: taxAmount, details: sp.get('taxDetails') || 'Sales Tax' } } : {}),
    };
    const r = await fetch(`${BASE}/invoices`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) });
    const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t.slice(0, 500); }
    return NextResponse.json({ action: 'create-invoice', httpStatus: r.status, sent: bodyObj, result: j });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
