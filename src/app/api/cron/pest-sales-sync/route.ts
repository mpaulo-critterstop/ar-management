// Pest Control sales sync — populates pest_sales from FR subscriptions per the verified mapping spec (v2).
// Upserts by externalKey (office:customerId:subscriptionId) so re-runs update rather than duplicate, and
// re-checks PENDING sales each run to flip initialDone + set commissionMonth when the initial completes.
//
//   /api/cron/pest-sales-sync?since=2026-01-01&office=All&token=critterstop2026
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
const EXCLUDE_SERVICEIDS = new Set(['836', '1077']);
const monthKey = (d: string) => (d && !d.startsWith('0000')) ? d.slice(0, 7) : null;
const toDate = (d: string) => (d && !d.startsWith('0000')) ? new Date(d) : null;

function pmMatcher(pmNames: string[]) {
  const full = new Set(pmNames.map(n => n.toLowerCase().trim()));
  const last = new Set(pmNames.map(n => n.toLowerCase().trim().split(/\s+/).pop()!));
  return (soldByName: string) => {
    const n = (soldByName || '').toLowerCase().trim();
    if (!n || n.startsWith('#')) return null;
    if (full.has(n)) { for (const p of pmNames) if (p.toLowerCase().trim() === n) return p; }
    const ln = n.split(/\s+/).pop()!;
    if (last.has(ln) && ln.length > 2) { for (const p of pmNames) if (p.toLowerCase().trim().split(/\s+/).pop() === ln) return p; }
    return null;
  };
}

async function loadCatalog(cfg: any): Promise<Map<string, { name: string; category: string }>> {
  const m = new Map<string, { name: string; category: string }>();
  const search = await frGet('serviceType/search', `officeIDs=${cfg.officeId}`, cfg.key, cfg.token);
  const ids: any[] = search?.typeIDs || search?.serviceTypeIDs || [];
  for (let i = 0; i < ids.length; i += 1000) {
    const got = await frGet('serviceType/get', `typeIDs=${ids.slice(i, i + 1000).join(',')}`, cfg.key, cfg.token);
    for (const o of (got?.serviceTypes || [])) m.set(String(o.serviceID ?? o.typeID), { name: o.description || o.serviceType || '', category: o.category || '' });
  }
  return m;
}

async function syncOffice(office: string, since: string, empMap: Map<string, string>, getPM: (n: string) => string | null) {
  const cfg = OFFICES[office];
  if (!cfg?.key) return { office, error: 'unconfigured' };
  const catalog = await loadCatalog(cfg);

  const range = JSON.stringify({ operator: 'BETWEEN', value: [`${since} 00:00:00`, '2027-12-31 23:59:59'] });
  const search = await frGet('subscription/search', `dateAdded=${encodeURIComponent(range)}`, cfg.key, cfg.token);
  const ids: number[] = search?.subscriptionIDs || [];
  if (!ids.length) return { office, upserted: 0 };

  const subs: any[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const r = await frGet('subscription/get', `subscriptionIDs=${idParam}`, cfg.key, cfg.token);
    (r?.subscriptions || []).forEach((s: any) => subs.push(s));
    await new Promise(res => setTimeout(res, 150));
  }

  const byCust = new Map<string, any[]>();
  for (const s of subs) { const c = String(s.customerID); if (!byCust.has(c)) byCust.set(c, []); byCust.get(c)!.push(s); }

  const soldByIds = [...new Set(subs.map(s => String(s.soldBy)).filter(x => x && x !== '0'))].filter(id => !empMap.has(id));
  if (soldByIds.length) {
    const r = await frGet('employee/get', `employeeIDs=${soldByIds.join(',')}`, cfg.key, cfg.token);
    (r?.employees || []).forEach((e: any) => empMap.set(String(e.employeeID), `${e.fname || ''} ${e.lname || ''}`.trim()));
  }

  // customer names
  const custIds = [...byCust.keys()];
  const custName = new Map<string, string>();
  for (let i = 0; i < custIds.length; i += 1000) {
    const r = await frGet('customer/get', `customerIDs=${custIds.slice(i, i + 1000).join(',')}`, cfg.key, cfg.token);
    (r?.customers || []).forEach((c: any) => custName.set(String(c.customerID), `${c.fname || ''} ${c.lname || ''}`.trim() || c.companyName || ''));
    await new Promise(res => setTimeout(res, 100));
  }

  const rows: any[] = [];
  for (const [customerID, arr] of byCust) {
    const parent = arr.find(s => String(s.serviceID) === '-1');
    const bundleStamp = parent?.dateAdded || null;
    const memberIds = new Set<string>();
    if (parent && bundleStamp) for (const s of arr) if (s.dateAdded === bundleStamp) memberIds.add(String(s.subscriptionID));

    if (parent && bundleStamp) {
      const pm = getPM(empMap.get(String(parent.soldBy)) || `#${parent.soldBy}`);
      const cv = Number(parent.contractValue);
      if (pm && cv > 0) {
        const child = arr.find(s => memberIds.has(String(s.subscriptionID)) && Number(s.recurringCharge) > 0);
        const cm = child ? monthKey(child.lastCompleted) : null;
        rows.push({
          office, customerId: customerID, customerName: custName.get(customerID) || null,
          externalKey: `${office}:${customerID}:${parent.subscriptionID}`, subscriptionId: String(parent.subscriptionID),
          category: 'Rodent Bundle', serviceName: 'Bundle', serviceId: '-1',
          pmName: pm, soldByFrId: String(parent.soldBy), contractValue: cv, recurringCharge: child ? Number(child.recurringCharge) : 0,
          saleDate: toDate(parent.dateAdded), initialDone: !!cm, initialCompletedAt: child ? toDate(child.lastCompleted) : null,
          commissionMonth: cm, chargeChildService: child ? catalog.get(String(child.serviceID))?.name : null,
        });
      }
    }
    for (const s of arr) {
      if (memberIds.has(String(s.subscriptionID)) || String(s.serviceID) === '-1') continue;
      if (EXCLUDE_SERVICEIDS.has(String(s.serviceID))) continue;
      const cat = catalog.get(String(s.serviceID));
      const category = cat?.category || '';
      const name = cat?.name || s.serviceType || `#${s.serviceID}`;
      const isT = category === 'Termite', isP = category === 'Pest Control';
      if (!isT && !isP) continue;
      if (EXCLUDE_NAME.test(name)) continue;
      const cv = Number(s.contractValue);
      if (cv <= 0) continue;
      const pm = getPM(empMap.get(String(s.soldBy)) || `#${s.soldBy}`);
      if (!pm) continue;
      const cm = monthKey(s.lastCompleted);
      rows.push({
        office, customerId: customerID, customerName: custName.get(customerID) || null,
        externalKey: `${office}:${customerID}:${s.subscriptionID}`, subscriptionId: String(s.subscriptionID),
        category: isT ? 'Termite' : 'Pest Control', serviceName: name, serviceId: String(s.serviceID),
        pmName: pm, soldByFrId: String(s.soldBy), contractValue: cv, recurringCharge: Number(s.recurringCharge),
        saleDate: toDate(s.dateAdded), initialDone: !!cm, initialCompletedAt: toDate(s.lastCompleted),
        commissionMonth: cm, chargeChildService: null,
      });
    }
  }

  let upserted = 0;
  for (const r of rows) {
    await prisma.pestSale.upsert({ where: { externalKey: r.externalKey }, create: r, update: r });
    upserted++;
  }
  return { office, subsScanned: subs.length, upserted };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const since = sp.get('since') || '2026-01-01';
  const officeParam = sp.get('office') || 'All';
  const offices = officeParam === 'All' ? Object.keys(OFFICES) : [officeParam];

  const plans = await prisma.commissionPlan.findMany({ select: { pmName: true }, distinct: ['pmName'] });
  const getPM = pmMatcher(plans.map(p => p.pmName));
  const empMap = new Map<string, string>();
  const results = [];
  for (const o of offices) results.push(await syncOffice(o, since, empMap, getPM));
  return NextResponse.json({ ok: true, since, results });
}
