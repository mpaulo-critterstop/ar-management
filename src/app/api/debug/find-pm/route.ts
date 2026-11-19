import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const fn = req.nextUrl.searchParams.get('fn') || 'Travis';
  const ln = req.nextUrl.searchParams.get('ln') || 'Doyle';
  const out: any = {};
  for (const [office, c] of Object.entries(FR_OFFICES)) {
    if (!c.key) continue;
    const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
    const s = await fetch(`${FR_BASE}/employee/search?${auth}&officeIDs=${c.officeId}&fname=${encodeURIComponent(fn)}&lname=${encodeURIComponent(ln)}`).then(r => r.json()).catch(() => null);
    const ids = s?.employeeIDs || [];
    if (ids.length) {
      const g = await fetch(`${FR_BASE}/employee/get?${auth}&employeeIDs=${ids.join(',')}${ids.length === 1 ? ',' + ids[0] : ''}`).then(r => r.json()).catch(() => null);
      out[office] = (g?.employees || []).map((e: any) => ({ id: e.employeeID, name: `${e.fname} ${e.lname}`, active: e.active }));
    }
  }
  return NextResponse.json({ searched: `${fn} ${ln}`, found: out });
}
