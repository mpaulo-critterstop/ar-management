// Discover the FR service-type catalog: the authoritative list of every serviceID + name, so we can
// categorize pest / termite / rodent-bundle definitively (each category has multiple serviceIDs).
// Tries likely endpoint names since FR's exact one is unknown, reports which works.
//   /api/debug/service-catalog?office=DFW&token=critterstop2026
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: '1' },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: '5' },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: '3' },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: '4' },
};
async function frGet(endpoint: string, params: string, key: string, token: string) {
  try {
    const res = await fetch(`${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
    return await res.json();
  } catch (e: any) { return { success: false, error: String(e) }; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const cfg = OFFICES[office];
  if (!cfg?.key) return NextResponse.json({ error: `Unknown office: ${office}` }, { status: 400 });

  // Try candidate catalog endpoints. FR convention: <entity>/search -> ids, <entity>/get -> objects.
  const candidates = ['serviceType', 'service', 'serviceOffering', 'productService'];
  const attempts: any[] = [];
  let catalog: any = null;

  for (const entity of candidates) {
    const search = await frGet(`${entity}/search`, `officeIDs=${cfg.officeId}`, cfg.key, cfg.token);
    const idField = search?.idName || `${entity}IDs`;
    const ids: any[] = search?.[idField] || search?.[`${entity}IDs`] || [];
    attempts.push({ entity, searchSuccess: !!search?.success, count: search?.count ?? 0, idField, sampleIds: ids.slice(0, 5) });
    if (search?.success && ids.length) {
      // fetch the objects
      const got = await frGet(`${entity}/get`, `${idField}=${ids.slice(0, 1000).join(',')}`, cfg.key, cfg.token);
      const propName = got?.propertyName || `${entity}s`;
      const objs = got?.[propName] || got?.[`${entity}s`] || [];
      if (objs.length) {
        catalog = {
          endpoint: entity,
          items: objs.map((o: any) => ({
            id: o.serviceID ?? o.typeID ?? o.id ?? o[`${entity}ID`],
            name: o.description ?? o.name ?? o.serviceType ?? o.serviceName,
            category: o.category ?? o.serviceCategory ?? null,
            raw: o,
          })),
        };
        break;
      }
    }
  }

  return NextResponse.json({
    office,
    attempts,
    catalog: catalog
      ? { endpoint: catalog.endpoint, count: catalog.items.length,
          items: catalog.items.map((i: any) => ({ id: i.id, name: i.name, category: i.category })) }
      : null,
    note: catalog ? 'Found catalog' : 'No catalog endpoint matched — see attempts',
  });
}
