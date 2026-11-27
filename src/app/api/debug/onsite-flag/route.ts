import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const txnId = '65e28fd9-6510-414d-ace1-2607223fd078';
  const t = await fetch(`${STAX_BASE}/transaction/${txnId}`, { headers: staxHeaders() }).then(r => r.json()).catch(() => null);
  // show ALL the places customer id could live
  return NextResponse.json({
    customer_id: t?.customer_id,
    customer_obj_id: t?.customer?.id,
    has_customer_obj: !!t?.customer,
    customer_reference_direct: t?.customer?.reference,
    payment_method_customer_id: t?.payment_method?.customer_id,
    person_name: t?.person_name,
    pm_person_name: t?.payment_method?.person_name,
    topLevelKeys: t ? Object.keys(t) : null,
  });
}
