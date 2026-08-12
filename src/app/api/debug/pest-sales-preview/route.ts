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
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
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
const EXCLUDE_NAME = /reservice|call\s*back|callback|\blead\b|inspection|renewal|follow\s*up|removal|reset|rebait|refill|pretreatment/i;
const EXCLUDE_SERVICEIDS = new Set(['836', '1077']); // Pretreatment (Termite + SubTermites) — not commissionable
const monthKey = (d: string) => (d && !d.startsWith('0000')) ? d.slice(0, 7) : null;

// PM scoping: only count sales sold by an actual PM (same list the commission tables use).
// Match on last name too, since FR soldBy names may differ slightly from commission_plans pmName.
function pmMatcher(pmNames: string[]) {
  const full = new Set(pmNames.map(n => n.toLowerCase().trim()));
  const last = new Set(pmNames.map(n => n.toLowerCase().trim().split(/\s+/).pop()!));
  return (soldByName: string) => {
    const n = (soldByName || '').toLowerCase().trim();
    if (!n || n.startsWith('#')) return false;
    if (full.has(n)) return true;
    const ln = n.split(/\s+/).pop()!;
    return last.has(ln) && ln.length > 2;
  };
}

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

async function scanOffice(office: string, since: string, limit: number, empMap: Map<string,string>, isPM: (n:string)=>boolean) {
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
  let skippedNonPM = 0;
  for (const [customerID, arr] of byCust) {
    const parent = arr.find(s => String(s.serviceID) === '-1');
    if (parent) {
      const soldByName = empMap.get(String(parent.soldBy)) || `#${parent.soldBy}`;
      if (!isPM(soldByName)) { skippedNonPM++; continue; }        // PM scope
      const chargeChild = arr.find(s => Number(s.recurringCharge) > 0);
      const cv = Number(parent.contractValue);
      if (cv <= 0) continue;                                       // no value -> skip
      const commMonth = chargeChild ? monthKey(chargeChild.lastCompleted) : null;
      sales.push({
        customerID, category: 'Rodent Bundle', service: 'Bundle (parent -1)',
        soldBy: soldByName, contractValue: cv,
        saleDate: (parent.dateAdded || '').slice(0,10),
        initialDone: !!commMonth,
        commissionMonth: commMonth || 'PENDING (initial not done)',
        chargeChildService: chargeChild ? catalog.get(String(chargeChild.serviceID))?.name : null,
      });
      continue;
    }
    for (const s of arr) {
      if (EXCLUDE_SERVICEIDS.has(String(s.serviceID))) continue;  // pretreatment etc.
      const cat = catalog.get(String(s.serviceID));
      const category = cat?.category || '';
      const name = cat?.name || s.serviceType || `#${s.serviceID}`;
      const isTermite = category === 'Termite';
      const isPest = category === 'Pest Control';
      if (!isTermite && !isPest) continue;
      if (EXCLUDE_NAME.test(name)) continue;
      const cv = Number(s.contractValue);
      if (cv <= 0) continue;                                       // standalone must have value
      const soldByName = empMap.get(String(s.soldBy)) || `#${s.soldBy}`;
      if (!isPM(soldByName)) { skippedNonPM++; continue; }         // PM scope
      const commMonth = monthKey(s.lastCompleted);
      sales.push({
        customerID, category: isTermite ? 'Termite' : 'Pest Control',
        service: name, serviceID: s.serviceID, soldBy: soldByName,
        contractValue: cv, recurringCharge: Number(s.recurringCharge),
        saleDate: (s.dateAdded || '').slice(0,10),
        initialDone: !!commMonth,
        commissionMonth: commMonth || 'PENDING (initial not done)',
      });
    }
  }
  return { office, scanned: subs.length, saleCount: sales.length, skippedNonPM, sales };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const since = sp.get('since') || '2026-06-01';
  const limit = Math.min(Number(sp.get('limit')) || 2000, 5000);
  const officeParam = sp.get('office') || 'All';
  const offices = officeParam === 'All' ? Object.keys(OFFICES) : [officeParam];
  const empMap = new Map<string,string>();
  // Canonical PM list = distinct pmName from commission_plans (same list the commission tables use).
  const plans = await prisma.commissionPlan.findMany({ select: { pmName: true }, distinct: ['pmName'] });
  const pmNames = plans.map(p => p.pmName);
  const isPM = pmMatcher(pmNames);
  const results = [];
  for (const o of offices) results.push(await scanOffice(o, since, limit, empMap, isPM));
  return NextResponse.json({ since, spec: 'v2', pmCount: pmNames.length, pmNames, offices: results });
}
