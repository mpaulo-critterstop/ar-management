// STAGE 1 mapping diagnostic (read-only): pull recent subscriptions across offices and surface the
// distinct serviceType values, how bundles are structured, and which sub in a bundle carries the
// contract value. Output is what we use to DEFINE the FR->commission-category mapping rules.
//
//   /api/debug/pest-mapping?since=2026-05-01&office=All&token=critterstop2026
//   &office=DFW|ATX|OKC|CStat|All   &since=YYYY-MM-DD (dateAdded filter)   &limit=... (subs per office)
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 800;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};
async function frGet(endpoint: string, params: string, key: string, token: string) {
  const res = await fetch(`${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return res.json();
}

async function scanOffice(office: string, since: string, limit: number) {
  const cfg = OFFICES[office];
  if (!cfg?.key) return { office, error: 'unconfigured' };

  // 1) find subscription IDs added since `since`
  const search = await frGet('subscription/search', `dateAdded=${since}`, cfg.key, cfg.token);
  const allIds: number[] = search?.subscriptionIDs || [];
  const ids = allIds.slice(0, limit);
  if (ids.length === 0) return { office, found: 0, note: 'no subscriptions in window' };

  // 2) fetch bodies in batches of 1000
  const subs: any[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const r = await frGet('subscription/get', `subscriptionIDs=${chunk.join(',')}`, cfg.key, cfg.token);
    (r?.subscriptions || []).forEach((s: any) => subs.push(s));
    await new Promise(res => setTimeout(res, 200));
  }

  // 3) aggregate serviceType landscape
  const byServiceType = new Map<string, { count: number; serviceIDs: Set<string>; withCharge: number; sampleContractValues: number[] }>();
  for (const s of subs) {
    const key = s.serviceType ?? `(null / serviceID=${s.serviceID})`;
    if (!byServiceType.has(key)) byServiceType.set(key, { count: 0, serviceIDs: new Set(), withCharge: 0, sampleContractValues: [] });
    const e = byServiceType.get(key)!;
    e.count++;
    e.serviceIDs.add(String(s.serviceID));
    if (Number(s.recurringCharge) > 0) e.withCharge++;
    if (e.sampleContractValues.length < 5) e.sampleContractValues.push(Number(s.contractValue));
  }

  // 4) bundle detection: group by customer, show customers with multiple subs (how bundles look)
  const byCustomer = new Map<string, any[]>();
  for (const s of subs) {
    const c = String(s.customerID);
    if (!byCustomer.has(c)) byCustomer.set(c, []);
    byCustomer.get(c)!.push(s);
  }
  const bundleExamples = [...byCustomer.entries()]
    .filter(([, arr]) => arr.length > 1)
    .slice(0, 8)
    .map(([customerID, arr]) => ({
      customerID,
      subCount: arr.length,
      subs: arr.map(s => ({
        subscriptionID: s.subscriptionID,
        serviceType: s.serviceType ?? `(null/serviceID=${s.serviceID})`,
        serviceID: s.serviceID,
        recurringCharge: Number(s.recurringCharge),
        contractValue: Number(s.contractValue),
        frequency: s.frequency,
        soldBy: s.soldBy,
        parentID: s.parentID,
        active: s.active,
      })),
    }));

  return {
    office,
    subscriptionsInWindow: allIds.length,
    scanned: subs.length,
    serviceTypes: [...byServiceType.entries()].map(([type, e]) => ({
      serviceType: type,
      count: e.count,
      serviceIDs: [...e.serviceIDs],
      subsWithRecurringCharge: e.withCharge,
      sampleContractValues: e.sampleContractValues,
    })).sort((a, b) => b.count - a.count),
    bundleExamples,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const since = sp.get('since') || '2026-05-01';
  const limit = Math.min(Number(sp.get('limit')) || 1500, 5000);
  const officeParam = sp.get('office') || 'All';
  const offices = officeParam === 'All' ? Object.keys(OFFICES) : [officeParam];

  const results = [];
  for (const o of offices) results.push(await scanOffice(o, since, limit));
  return NextResponse.json({ since, limit, offices: results });
}
