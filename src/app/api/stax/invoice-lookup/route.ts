// Invoice lookup for the "Take Payment" virtual terminal. Given an FR invoice (ticket) number, searches all
// offices to find it and returns the customer name, email, phone, office, and balance due so the CSR can confirm
// the right invoice before taking the card. Read-only.
//   GET /api/stax/invoice-lookup?invoice=<FR ticket #>
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const FR: Record<string, { key?: string; token?: string }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW, token: process.env.FIELDROUTES_TOKEN_DFW },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX, token: process.env.FIELDROUTES_TOKEN_ATX },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC, token: process.env.FIELDROUTES_TOKEN_OKC },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT, token: process.env.FIELDROUTES_TOKEN_CSTAT },
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const invoiceNumber = String(req.nextUrl.searchParams.get('invoice') || '').trim();
  if (!invoiceNumber) return NextResponse.json({ error: 'invoice required' }, { status: 400 });

  // Search each office for this ticket id (FR ticket IDs are office-scoped).
  for (const [office, fr] of Object.entries(FR)) {
    if (!fr.key) continue;
    try {
      const tr = await fetch(`${FR_BASE}/ticket/get?ticketIDs=${invoiceNumber},${invoiceNumber}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`);
      const tj = await tr.json();
      const tk = (tj.tickets || [])[0];
      if (!tk) continue; // not in this office, try next

      const custId = String(tk.customerID);
      const cr = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&authenticationKey=${fr.key}&authenticationToken=${fr.token}`);
      const cj = await cr.json();
      const cu = (cj.customers || [])[0] || {};
      const name = `${cu.fname || ''} ${cu.lname || ''}`.trim() || cu.companyName || 'Customer';

      return NextResponse.json({
        found: true,
        office,
        invoiceNumber,
        customerId: custId,
        customerName: name,
        email: cu.email || cu.billingEmail || '',
        phone: cu.phone1 || cu.phone2 || '',
        total: Number(tk.total || 0),
        balance: Number(tk.balance || 0),
        serviceDescription: tk.serviceDescription || tk.description || '',
      });
    } catch { /* try next office */ }
  }

  return NextResponse.json({ found: false, error: `Invoice ${invoiceNumber} not found in any office` }, { status: 404 });
}
