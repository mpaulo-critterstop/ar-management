import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const inv = req.nextUrl.searchParams.get('inv') || '286326';
  // 1) the Hub ledger row for this invoice (flagged?)
  const hubRows = await prisma.staxPayment.findMany({ where: { frInvoiceNumber: inv } });
  // 2) find the Stax txn — search recent transactions for one referencing this invoice
  const headers = staxHeaders();
  const found: any[] = [];
  for (let page = 1; page <= 8; page++) {
    const r = await fetch(`${STAX_BASE}/transaction?page=${page}&per_page=50`, { headers });
    const j = await r.json().catch(() => null);
    const data = j?.data || [];
    if (!data.length) break;
    for (const t of data) {
      const metaInv = t?.meta?.fr_invoice || t?.meta?.invoice_number || t?.invoice?.meta?.fr_invoice || t?.payment_method?.meta?.fr_invoice;
      const hay = JSON.stringify(t);
      if (String(metaInv) === inv || hay.includes(`"${inv}"`) || hay.includes(inv)) {
        found.push({
          id: t.id, type: t.type, total: t.total, success: t.success, created: t.created_at,
          customer: t?.customer ? `${t.customer.firstname} ${t.customer.lastname}` : null,
          meta: t.meta, invoice_meta: t?.invoice?.meta, pm_meta: t?.payment_method?.meta,
          invoice_id: t.invoice_id, schedule_id: t.schedule_id,
          whereInvoiceAppears: { in_meta_fr_invoice: t?.meta?.fr_invoice === inv, in_meta_at_all: JSON.stringify(t.meta||{}).includes(inv), in_invoice_obj: JSON.stringify(t.invoice||{}).includes(inv) },
        });
      }
    }
  }
  return NextResponse.json({ invoice: inv, hubLedgerRows: hubRows.map(r=>({ staxTransactionId:r.staxTransactionId, status:r.status, failReason:r.failReason, amount:r.amount, cardHolderName:r.cardHolderName })), staxTxnsReferencingInvoice: found });
}
