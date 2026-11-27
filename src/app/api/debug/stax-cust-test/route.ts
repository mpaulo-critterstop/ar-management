import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const headers = staxHeaders();
  // test creating a Stax customer (same payload shape as the payment-link flow)
  const r = await fetch(`${STAX_BASE}/customer`, {
    method: 'POST', headers,
    body: JSON.stringify({ firstname: 'Test', lastname: 'Hub', email: undefined, phone: undefined, reference: 'FR-TEST-DEBUG' }),
  });
  const status = r.status;
  const j = await r.json().catch(() => null);
  return NextResponse.json({ httpStatus: status, response: j, headersSent: Object.keys(headers) });
}
