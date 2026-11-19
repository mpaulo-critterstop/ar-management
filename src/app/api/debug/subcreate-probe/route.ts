import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
// DRY probe: call subscription/create with a deliberately minimal payload to see what FR says is required.
// Does NOT create anything real (missing required fields -> error that lists them). Token-gated.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  // minimal: just serviceID + customerID of a test — expect FR to complain about required fields
  const qs = `customerID=999999999&serviceID=533`; // bogus customer so nothing real is created
  const r = await fetch(`${FR_BASE}/subscription/create?${auth}&${qs}`, { method: 'POST' });
  const text = await r.text();
  return NextResponse.json({ status: r.status, response: text.slice(0, 1000) });
}
