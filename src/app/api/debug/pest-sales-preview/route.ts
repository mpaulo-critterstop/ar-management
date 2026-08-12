// STAGE 2a diagnostic (read-only): apply the FULL pest-sale mapping spec to recent subscriptions and
// output the categorized sales list for eyeball verification BEFORE we store anything or compute payouts.
//
//   /api/debug/pest-sales-preview?since=2026-06-01&office=All&token=critterstop2026
//
// Spec applied:
//  - Categories from FR serviceType.category: "Pest Control" | "Termite" (+ bundle structure for Rodent).
//  - Rodent Bundle = a bundle PARENT (serviceID -1) on the account; CV from the parent; charge-bearing
//    child (recurringCharge>0) drives the commission month.
//  - Sale = new recurring OR one-time; EXCLUDE reservice/callback/lead/inspection (by name), termite CV=0
//    (renewal), SubTermites, Wildlife, General/SYSTEM/blank.
//  - Sale date = dateAdded. Commission month = month initial service completed (lastCompleted); if not yet
//    completed => "pending" (no commission).
//  - Fetch fix: pad single-ID subscription/get (duplicate the id).
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 800;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: '1' },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: '5' },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: '3' },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: '4' },
};
async function frGet(endpoint: string, params: string, key: string, token: string) {
  const res = await fetch(`${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return res.json();
}
const EXCLUDE_NAME = /reservice|call\s*back|callback|\blead\b|inspection|renewal|follow\s*up|removal|reset|rebait|refill/i;
const monthKey = (d: string) => (d && !d.startsWith('0000')) ? d.slice(0, 7) : null;

async function loadCatalog(cfg: {key:string;token:string;officeId:string}): Promise<Map<string,{name:string;category:string}>> {
  const m = new Map<string,{name:string;category:string}>();
  const search = await frGet('serviceType/search', `officeIDs=${cfg.officeId}`, cfg.key, cfg.token);
  const ids: any[] = search?.typeIDs || search?.serviceTypeIDs || [];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const got = await frGet('serviceType/get', `typeIDs=${chunk.join(',')}`, cfg.key, cfg.token);
    const objs = got?.serviceTypes || got?.[got?.propertyName] || [];
    for (const o of objs) m.set(String(o.serviceID ?? o.typeID), { name: o.description || o.serviceType || '', category: o.category || '' });
  }
  return m;
}

async function scanOffice(office: string, since: string, limit: number, empMap: Map<string,string>) {
  const cfg = OFFICES[office];
  if (!cfg?.key) return { office, error: 'unconfigured' };

  const catalog = await loadCatalog(cfg);   // authoritative serviceID -> {name, category}

  const search = await frGet('subscription/search', `dateAdded=${since}`, cfg.key, cfg.token);
  const ids: number[] = (search?.subscriptionIDs || []).slice(0, limit);
  if (!ids.length) return { office, sales: [], note: 'no subs in window' };

  // fetch bodies (batch 1000; pad single-id)
  const subs: any[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    let chunk = ids.slice(i, i + 1000);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const r = await frGet('subscription/get', `subscriptionIDs=${idParam}`, cfg.key, cfg.token);
    (r?.subscriptions || []).forEach((s: any) => subs.push(s));
    await new Promise(res => setTimeout(res, 150));
  }

  // group by customer to detect bundles (parent serviceID -1)
  const byCust = new Map<string, any[]>();
  for (const s of subs) { const c = String(s.customerID); if (!byCust.has(c)) byCust.set(c, []); byCust.get(c)!.push(s); }

  // resolve soldBy employee IDs -> names (batch)
  const soldByIds = [...new Set(subs.map(s => String(s.soldBy)).filter(x => x && x !== '0'))];
  const unresolved = soldByIds.filter(id => !empMap.has(id));
  if (unresolved.length) {
    const r = await frGet('employee/get', `employeeIDs=${unresolved.join(',')}`, cfg.key, cfg.token);
    (r?.employees || []).forEach((e: any) => empMap.set(String(e.employeeID), `${e.fname||''} ${e.lname||''}`.trim()));
  }

  const sales: any[] = [];
  for (const [customerID, arr] of byCust) {
    const parent = arr.find(s => String(s.serviceID) === '-1');
    if (parent) {
      // BUNDLE: one Rodent Bundle sale. CV from parent. Charge-bearing child drives commission month.
      const chargeChild = arr.find(s => Number(s.recurringCharge) > 0);
      const cv = Number(parent.contractValue);
      const commMonth = chargeChild ? monthKey(chargeChild.lastCompleted) : null;
      sales.push({
        customerID, category: 'Rodent Bundle',
        service: 'Bundle (parent -1)',
        soldBy: empMap.get(String(parent.soldBy)) || `#${parent.soldBy}`,
        contractValue: cv,
        saleDate: parent.dateAdded?.slice(0,10),
        initialDone: !!commMonth,
        commissionMonth: commMonth || 'PENDING (initial not done)',
        chargeChildService: chargeChild ? catalog.get(String(chargeChild.serviceID))?.name : null,
      });
      continue;
    }
    // Non-bundle subs: evaluate each using the AUTHORITATIVE catalog category
    for (const s of arr) {
      const cat = catalog.get(String(s.serviceID));
      const category = cat?.category || '';
      const name = cat?.name || s.serviceType || `#${s.serviceID}`;
      const isTermite = category === 'Termite';
      const isPest = category === 'Pest Control';
      if (!isTermite && !isPest) continue;                       // wildlife/subtermites/general/blank -> skip
      if (EXCLUDE_NAME.test(name)) continue;                     // reservice/callback/lead/inspection/renewal
      const cv = Number(s.contractValue);
      if (isTermite && cv <= 0) continue;                        // termite renewal -> skip
      const commMonth = monthKey(s.lastCompleted);
      sales.push({
        customerID, category: isTermite ? 'Termite' : 'Pest Control',
        service: name, serviceID: s.serviceID,
        soldBy: empMap.get(String(s.soldBy)) || `#${s.soldBy}`,
        contractValue: cv,
        recurringCharge: Number(s.recurringCharge),
        saleDate: s.dateAdded?.slice(0,10),
        initialDone: !!commMonth,
        commissionMonth: commMonth || 'PENDING (initial not done)',
      });
    }
  }
  return { office, scanned: subs.length, saleCount: sales.length, sales };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const since = sp.get('since') || '2026-06-01';
  const limit = Math.min(Number(sp.get('limit')) || 2000, 5000);
  const officeParam = sp.get('office') || 'All';
  const offices = officeParam === 'All' ? Object.keys(OFFICES) : [officeParam];
  const empMap = new Map<string,string>();
  const results = [];
  for (const o of offices) results.push(await scanOffice(o, since, limit, empMap));
  return NextResponse.json({ since, spec: 'v1', offices: results });
}
