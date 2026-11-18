import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const SL_BASE = 'https://api.smarterlaunch.com/api/v1';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uuid = req.nextUrl.searchParams.get('uuid') || '80ffd31b-c535-4a1b-8c46-7795be9dbf5e';
  const KEY = process.env.SMARTERLAUNCH_API_KEY;
  if (!KEY) return NextResponse.json({ error: 'no SL key' });
  const h = { 'X-API-Key': KEY, 'Accept': 'application/json' };
  const res = await fetch(`${SL_BASE}/proposals/${uuid}`, { headers: h });
  const status = res.status;
  const json = await res.json().catch(() => null);
  // Dump the structure so we see where guarantee/pricing data lives — WITHOUT guessing paths.
  const d = json?.data || json || {};
  const shape = (o: any, depth = 0): any => {
    if (depth > 3 || o === null) return typeof o;
    if (Array.isArray(o)) return o.length ? [shape(o[0], depth + 1)] : [];
    if (typeof o === 'object') { const r: any = {}; for (const k of Object.keys(o).slice(0, 40)) r[k] = shape(o[k], depth + 1); return r; }
    return typeof o;
  };
  // also find any key/value mentioning guarantee anywhere in the tree
  const guaranteeHits: string[] = [];
  (function walk(o: any, path: string) {
    if (!o || typeof o !== 'object') { if (typeof o === 'string' && /guarantee|warranty|lifetime|year/i.test(o)) guaranteeHits.push(`${path} = ${o}`); return; }
    for (const [k, v] of Object.entries(o)) {
      if (/guarantee|warranty/i.test(k)) guaranteeHits.push(`${path}.${k} (key)`);
      walk(v, path ? `${path}.${k}` : k);
    }
  })(d, '');
  return NextResponse.json({ status, topKeys: Object.keys(d), structure: shape(d), guaranteeHits: guaranteeHits.slice(0, 40) });
}
