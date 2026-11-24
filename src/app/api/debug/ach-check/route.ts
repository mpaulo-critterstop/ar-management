import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const inv = req.nextUrl.searchParams.get('inv') || '283138';
  const headers = staxHeaders();
  // find the stax txn(s) for this invoice (search recent pages by meta.fr_invoice)
  const matches: any[] = [];
  for (let page = 1; page <= 12; page++) {
    const r = await fetch(`${STAX_BASE}/transaction?page=${page}&per_page=50`, { headers });
    const j = await r.json().catch(() => null);
    const data = j?.data || [];
    if (!data.length) break;
    for (const t of data) {
      const metaInv = t?.meta?.fr_invoice || t?.meta?.invoice || '';
      if (String(metaInv) === inv || String(t?.invoice_id||'')===inv) {
        matches.push({ id: t.id, type: t.type, method: t.method, total: t.total, success: t.success, status: t.status, is_voided: t.is_voided, is_refunded: t.is_refunded, total_refunded: t.total_refunded, created_at: t.created_at, updated_at: t.updated_at, child_transactions: (t.child_transactions||[]).map((c:any)=>({id:c.id,type:c.type,total:c.total,success:c.success,status:c.status,created:c.created_at})) });
      }
    }
  }
  // what the Hub has stored
  const hubRows = await prisma.staxPayment.findMany({ where: { frInvoiceNumber: inv } });
  return NextResponse.json({ invoice: inv, staxMatches: matches, hubRecords: hubRows.map(r=>({ id:r.id, staxTransactionId:r.staxTransactionId, status:r.status, amount:r.amount, frPaymentId:r.frPaymentId, office:r.office, method:r.method, createdAt:r.createdAt })) });
}
