// Probe the FR product catalog — lists all products (id + name/category) so we can find every insulation
// product (FAR, Insulation Removal only, Insulation Top-off only, etc.) by name in one shot.
//   /api/cron/fr-products?token=critterstop2026&office=DFW
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};
async function fr(url: string) { const r = await fetch(url); return r.json(); }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cfg = OFFICES[sp.get('office') || 'DFW'];
  if (!cfg?.key) return NextResponse.json({ error: 'bad office' }, { status: 400 });
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

  // Try the product endpoint (search -> get). Report what comes back.
  const search = await fr(`${BASE_URL}/product/search?${auth}`);
  const idName = search?.idName;
  const ids: any[] = search?.productIDs || search?.[idName] || [];
  let products: any[] = [];
  if (ids.length) {
    // get in one batch (catalogs are small)
    const idParam = ids.length === 1 ? `${ids[0]},${ids[0]}` : ids.join(',');
    const g = await fr(`${BASE_URL}/product/get?productIDs=${idParam}&${auth}`);
    products = (g.products || []).map((p: any) => ({ productID: p.productID, name: p.name || p.description || p.productName, category: p.category, glNumber: p.glNumber, _keys: Object.keys(p) }));
  }

  return NextResponse.json({
    searchSuccess: search?.success, searchKeys: search && typeof search === 'object' ? Object.keys(search).filter(k => !['params'].includes(k)) : null,
    idName, count: ids.length,
    products,
  });
}
