import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const SL_BASE = 'https://api.smarterlaunch.com/api/v1';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = sp.get('custId') || '40802';
  const out: any = { custId };
  const c = FR_OFFICES.DFW;
  const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
  const cg = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&${auth}`).then(r => r.json()).catch(() => null);
  const cust = cg?.customers?.[0];
  out.frCustomer = cust ? { name: `${cust.fname} ${cust.lname}`, email: cust.email } : null;
  // exclusion completion
  const asj = await fetch(`${FR_BASE}/appointment/search?${auth}&customerIDs=${custId}&serviceID=553`).then(r => r.json()).catch(() => null);
  const aids = asj?.appointmentIDs || [];
  if (aids.length) { const g = await fetch(`${FR_BASE}/appointment/get?${auth}&appointmentIDs=${aids.join(',')}${aids.length === 1 ? ',' + aids[0] : ''}`).then(r => r.json()).catch(() => null); const done = (g?.appointments || []).filter((a: any) => a.dateCompleted && a.dateCompleted !== '0000-00-00 00:00:00'); out.exclusionCompleted = done.length ? done.sort((a: any, b: any) => String(b.dateCompleted).localeCompare(String(a.dateCompleted)))[0].dateCompleted : null; }
  // existing subs
  const ss = await fetch(`${FR_BASE}/subscription/search?${auth}&customerIDs=${custId}`).then(r => r.json()).catch(() => null);
  const sids = ss?.subscriptionIDs || [];
  let subs: any[] = [];
  if (sids.length) { const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${sids.join(',')}${sids.length === 1 ? ',' + sids[0] : ''}`).then(r => r.json()).catch(() => null); subs = g?.subscriptions || []; }
  out.existingSubs = subs.map((s: any) => ({ id: s.subscriptionID, serviceID: s.serviceID, type: s.serviceType, active: s.active }));
  out.has533 = subs.some((s: any) => String(s.serviceID) === '533');
  out.has504 = subs.some((s: any) => String(s.serviceID) === '504');
  // SL guarantee + PM
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
  let uuid = null;
  for (const r of rows) { try { const rec = JSON.parse(r.value); if (String(rec.frCustomerId) === custId) { uuid = rec.customerUuid; break; } } catch {} }
  out.slUuid = uuid;
  const KEY = process.env.SMARTERLAUNCH_API_KEY;
  if (uuid && KEY) {
    const h = { 'X-API-Key': KEY, 'Accept': 'application/json' };
    const pr = await fetch(`${SL_BASE}/proposals?customer_uuid=${uuid}`, { headers: h }).then(r => r.json()).catch(() => null);
    const accepted = (pr?.data || []).find((p: any) => p.status?.status_code === 'PROPOSAL_ACCEPTED') || (pr?.data || [])[0];
    if (accepted) {
      const det = await fetch(`${SL_BASE}/proposals/${accepted.uuid}`, { headers: h }).then(r => r.json()).catch(() => null);
      const d = det?.data || {};
      const gOpts: Record<string, string> = {};
      for (const pl of (d.proposal_template_data?.service_plans || [])) for (const g of (pl.service_plan_pricing_groups || [])) if (g.uuid && g.name && /guarantee|warranty/i.test(g.name)) gOpts[g.uuid] = g.name;
      const pv = d.latest_version?.proposal_values || {};
      const sel = (v: any) => v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0' && v.trim().toLowerCase() !== 'false');
      const selU: Record<string, any> = {};
      (function walk(o: any) { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (typeof k === 'string' && k.length === 36 && sel(v)) selU[k] = v; walk(v); } })(pv);
      out.SELECTED_GUARANTEES = Object.keys(selU).filter(u => gOpts[u]).map(u => gOpts[u]);
      out.salesRep = d.user ? `${d.user.first_name} ${d.user.last_name}` : null;
    }
  }
  return NextResponse.json(out);
}
