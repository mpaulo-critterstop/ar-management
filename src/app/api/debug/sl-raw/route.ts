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
  const json = await res.json().catch(() => null);
  const d = json?.data || {};

  // 1) Template guarantee options (name by uuid) from service_plans[].service_plan_pricing_groups[]
  const guaranteeOptions: Record<string, string> = {}; // uuid -> name
  const plans = d.proposal_template_data?.service_plans || [];
  for (const pl of plans) for (const g of (pl.service_plan_pricing_groups || [])) {
    if (g.uuid && g.name && /guarantee|warranty/i.test(g.name)) guaranteeOptions[g.uuid] = g.name;
  }

  // 2) Selected values — scan proposal_values for any key matching a guarantee option uuid with a truthy value
  const pv = d.latest_version?.proposal_values || {};
  const sel = (v: any) => v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0' && v.trim().toLowerCase() !== 'false');
  // collect ALL truthy-valued entries anywhere in proposal_values, keyed by uuid
  const selectedUuids: Record<string, any> = {};
  (function walk(o: any) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof k === 'string' && k.length === 36 && sel(v)) selectedUuids[k] = v;
      walk(v);
    }
  })(pv);

  // 3) Which selected uuid is a guarantee option?
  const selectedGuarantee = Object.keys(selectedUuids).filter(u => guaranteeOptions[u]).map(u => ({ uuid: u, name: guaranteeOptions[u], value: selectedUuids[u] }));

  return NextResponse.json({
    status: res.status,
    guaranteeOptionsInTemplate: Object.values(guaranteeOptions),
    SELECTED_GUARANTEE: selectedGuarantee,
    proposalValuesKeys: Object.keys(pv),
    selectedUuidCount: Object.keys(selectedUuids).length,
  });
}
