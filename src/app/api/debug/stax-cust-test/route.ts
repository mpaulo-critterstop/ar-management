import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders } from '@/lib/staxBridge';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const headers = staxHeaders();
  // test various payloads to find what breaks it
  const tests: Record<string, any> = {
    withEmail: { firstname: 'Test', lastname: 'Hub', email: 'test@example.com', reference: 'FR-T1' },
    withPhone: { firstname: 'Test', lastname: 'Hub', phone: '2145551234', reference: 'FR-T2' },
    badEmail: { firstname: 'Test', lastname: 'Hub', email: 'notanemail', reference: 'FR-T3' },
    emptyLast: { firstname: 'Test', lastname: '-', reference: 'FR-T4' },
    specialChars: { firstname: "O'Brien", lastname: 'Smith & Co', reference: 'FR-T5' },
  };
  const results: Record<string, any> = {};
  for (const [name, body] of Object.entries(tests)) {
    const r = await fetch(`${STAX_BASE}/customer`, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    results[name] = { status: r.status, gotId: !!j?.id, error: j?.id ? null : j };
  }
  return NextResponse.json(results);
}
