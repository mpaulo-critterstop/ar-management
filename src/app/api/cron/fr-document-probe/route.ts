// READ-ONLY probe: discover whether FieldRoutes exposes a documents/files endpoint, and fetch them for a
// given customer. Tries several likely entity names and reports which respond.
//   /api/cron/fr-document-probe?token=critterstop2026&office=DFW&cust=12353
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

async function tryFr(entity: string, action: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${entity}/${action}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  try {
    const r = await fetch(url);
    const status = r.status;
    let body: any = null;
    try { body = await r.json(); } catch { body = '(non-JSON)'; }
    return { entity, action, httpStatus: status, ok: r.ok, keys: body && typeof body === 'object' ? Object.keys(body).slice(0, 15) : null, sample: JSON.stringify(body).substring(0, 400) };
  } catch (e: any) {
    return { entity, action, error: e.message };
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const cust = sp.get('cust');
  const cfg = OFFICES[office];
  if (!cfg?.key || !cust) return NextResponse.json({ error: 'need office + cust' }, { status: 400 });

  // Candidate document-ish entities to probe, with a customerIDs filter.
  const entities = ['document', 'customerDocument', 'documents', 'file', 'attachment', 'media', 'customerFile'];
  const results: any[] = [];
  for (const ent of entities) {
    results.push(await tryFr(ent, 'search', `customerIDs=${cust}`, cfg.key, cfg.token));
  }
  return NextResponse.json({ office, cust, results });
}
