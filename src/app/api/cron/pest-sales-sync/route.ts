// Pest Control sales sync — populates pest_sales from FR subscriptions per the verified mapping spec (v2).
// Upserts by externalKey (office:customerId:subscriptionId) so re-runs update rather than duplicate, and
// re-checks PENDING sales each run to flip initialDone + set commissionMonth when the initial completes.
//
//   /api/cron/pest-sales-sync?since=2026-01-01&office=All&token=critterstop2026
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { classifyPestCommission } from '@/lib/pestCommission';
import { waitUntil } from '@vercel/functions';

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
// Termite product names legitimately contain "renewal", "removal", "monitoring" — so termite uses a
// REDUCED exclusion (only genuine non-sales: inspection, follow-up, reservice, callback, lead).
const EXCLUDE_NAME_TERMITE = /reservice|call\s*back|callback|\blead\b|inspection|follow\s*up/i;
const EXCLUDE_SERVICEIDS = new Set(['836', '1077']);
// Wildlife service types that are normally excluded, but should be TRACKED as CSR pest sales under the
// 'Mole/OLT' category (CSR-only — never PM commission). Per Mark.
const MOLE_OLT_SERVICEIDS = new Set(['683', '631', '526', '489', '685', '691', '684', '690']);
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

async function syncOffice(office: string, since: string, empMap: Map<string, string>, getPM: (n: string) => string | null, getCSR: (n: string) => string | null) {
  // PM sales before this date are owned by the Excel history backfill (source='excel'); pulling them from
  // FR would create duplicate 'fr' rows for the same sale → double-count in PM commissions/KPI. So we skip
  // PM sales dated before the boundary. CSR sales have NO Excel history, so they're pulled for the full range.
  const PM_FR_BOUNDARY = new Date(Date.UTC(2026, 7, 1)); // Aug 1 2026
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

  // TRUE initial-service date: the completion date of each sub's INITIAL appointment (not lastCompleted,
  // which is the most recent service). Fetch those appointments and map initialAppointmentID -> completedOn.
  const apptIds = [...new Set(subs.map(s => String(s.initialAppointmentID)).filter(x => x && x !== '0'))];
  const initApptDone = new Map<string, string | null>(); // apptID -> completed date (or null if not completed)
  for (let i = 0; i < apptIds.length; i += 1000) {
    const chunk = apptIds.slice(i, i + 1000);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const r = await frGet('appointment/get', `appointmentIDs=${idParam}`, cfg.key, cfg.token);
    for (const a of (r?.appointments || [])) {
      // FR appointment: status 1/"Completed"; dateCompleted holds the completion timestamp.
      const done = (String(a.status) === '1' || /complete/i.test(a.statusText || '')) ? (a.dateCompleted || a.checkOut || a.start || null) : null;
      initApptDone.set(String(a.appointmentID), done && !String(done).startsWith('0000') ? done : null);
    }
    await new Promise(res => setTimeout(res, 120));
  }
  // Helper: given a subscription, return its true initial-service completion date (or null if not done).
  const initialDateOf = (sub: any): string | null => initApptDone.get(String(sub.initialAppointmentID)) || null;

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
  let staleCsrCleaned = 0;
  for (const [customerID, arr] of byCust) {
    const parent = arr.find(s => String(s.serviceID) === '-1');
    const bundleStamp = parent?.dateAdded || null;
    const memberIds = new Set<string>();
    if (parent && bundleStamp) for (const s of arr) if (s.dateAdded === bundleStamp) memberIds.add(String(s.subscriptionID));

    if (parent && bundleStamp) {
      const soldByName = empMap.get(String(parent.soldBy)) || `#${parent.soldBy}`;
      const pm = getPM(soldByName);
      const csr = pm ? null : getCSR(soldByName);   // PM takes precedence; else try CSR
      const seller = pm || csr;
      const cv = Number(parent.contractValue);
      const saleDt = toDate(parent.dateAdded);
      // Skip PM sales before the Excel/FR boundary (avoid double-count). CSR sales are fine any time.
      // But if this sub was previously mis-tagged CSR and has since been corrected to a PM in FR, remove
      // the stale CSR row (it can't become a PM row here due to the guard, so just delete it).
      if (pm && saleDt && saleDt < PM_FR_BOUNDARY) {
        const del = await prisma.pestSale.deleteMany({ where: { externalKey: `${office}:${customerID}:${parent.subscriptionID}`, sellerType: 'csr' } });
        staleCsrCleaned += del.count;
        continue;
      }
      if (seller && cv > 0) {
        const child = arr.find(s => memberIds.has(String(s.subscriptionID)) && Number(s.recurringCharge) > 0);
        const childInit = child ? initialDateOf(child) : null;
        const cm = childInit ? monthKey(childInit) : null;
        rows.push({
          office, customerId: customerID, customerName: custName.get(customerID) || null,
          externalKey: `${office}:${customerID}:${parent.subscriptionID}`, subscriptionId: String(parent.subscriptionID),
          category: 'Rodent Bundle', serviceName: 'Bundle', serviceId: '-1',
          pmName: pm, sellerType: pm ? 'pm' : 'csr', sellerName: seller,
          soldByFrId: String(parent.soldBy), contractValue: cv, recurringCharge: child ? Number(child.recurringCharge) : 0,
          saleDate: toDate(parent.dateAdded), initialDone: !!cm, initialCompletedAt: toDate(childInit),
          commissionMonth: cm, chargeChildService: child ? catalog.get(String(child.serviceID))?.name : null,
        });
      }
    }
    for (const s of arr) {
      if (memberIds.has(String(s.subscriptionID)) || String(s.serviceID) === '-1') continue;
      if (EXCLUDE_SERVICEIDS.has(String(s.serviceID))) continue;
      const cat = catalog.get(String(s.serviceID));
      const frCategory = cat?.category || '';
      const name = cat?.name || s.serviceType || `#${s.serviceID}`;
      const isMoleOlt = MOLE_OLT_SERVICEIDS.has(String(s.serviceID));
      // Fine-grained commission category (peels Mosquito/Misting/Bed Bug/Flea-Roach/Bait/Fly/standalone
      // rodent out of FR "Pest Control"; excludes inspections/reservice/etc.).
      // Mole/OLT service IDs are Wildlife (normally excluded) but should be TRACKED as CSR sales under a
      // dedicated 'Mole/OLT' category — never as PM commission (handled below by dropping PM sellers).
      const commCat = isMoleOlt ? 'Mole/OLT' : classifyPestCommission(frCategory, name);
      if (commCat === 'EXCLUDE') continue;
      const isT = commCat === 'Termite';
      const cv = Number(s.contractValue);
      const rc = Number(s.recurringCharge);
      // Termite counts if CV>0 OR recurringCharge>0 (CSR-error cases). Everything else needs CV>0.
      if (isT) { if (cv <= 0 && rc <= 0) continue; }
      else if (cv <= 0) continue;
      const soldByName = empMap.get(String(s.soldBy)) || `#${s.soldBy}`;
      const pm = getPM(soldByName);
      const csr = pm ? null : getCSR(soldByName);   // PM precedence; else CSR
      const seller = pm || csr;
      if (!seller) continue;
      // Mole/OLT is CSR-tracking only — if a PM somehow sold it, don't record it (no PM commission).
      if (isMoleOlt && pm) continue;
      // Skip PM sales before the Excel/FR boundary (avoid double-count). CSR sales are fine any time.
      const saleDt = toDate(s.dateAdded);
      if (pm && saleDt && saleDt < PM_FR_BOUNDARY) {
        // Corrected mis-tag: sub is now PM-owned but pre-boundary — remove any stale CSR row for it.
        const del = await prisma.pestSale.deleteMany({ where: { externalKey: `${office}:${customerID}:${s.subscriptionID}`, sellerType: 'csr' } });
        staleCsrCleaned += del.count;
        continue;
      }
      const initDate = initialDateOf(s);
      const cm = monthKey(initDate);
      rows.push({
        office, customerId: customerID, customerName: custName.get(customerID) || null,
        externalKey: `${office}:${customerID}:${s.subscriptionID}`, subscriptionId: String(s.subscriptionID),
        category: commCat, serviceName: name, serviceId: String(s.serviceID),
        pmName: pm, sellerType: pm ? 'pm' : 'csr', sellerName: seller,
        soldByFrId: String(s.soldBy), contractValue: cv, recurringCharge: rc,
        saleDate: toDate(s.dateAdded), initialDone: !!cm, initialCompletedAt: toDate(initDate),
        commissionMonth: cm, chargeChildService: null,
      });
    }
  }

  let upserted = 0;
  for (const r of rows) {
    await prisma.pestSale.upsert({ where: { externalKey: r.externalKey }, create: r, update: r });
    upserted++;
  }
  return { office, subsScanned: subs.length, upserted, staleCsrCleaned };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const since = sp.get('since') || '2026-08-01';
  const officeParam = sp.get('office') || 'All';
  const offices = officeParam === 'All' ? Object.keys(OFFICES) : [officeParam];

  // ?wait=1 → run inline and return full result (manual/debug). Default → fire-and-forget via waitUntil
  // (returns instantly so cron-job.org never hits the 30s timeout; work completes in the background).
  if (sp.get('wait') === '1') {
    const result = await runPestSync(since, offices);
    return NextResponse.json(result);
  }
  waitUntil(runPestSync(since, offices).catch(e => { console.error('pest-sales-sync background error:', e); }));
  return NextResponse.json({ ok: true, started: true, since, offices, note: 'Sync running in background. Use ?wait=1 for inline result.' });
}

async function runPestSync(since: string, offices: string[]) {
  const plans = await prisma.commissionPlan.findMany({ select: { pmName: true }, distinct: ['pmName'] });
  const getPM = pmMatcher(plans.map(p => p.pmName));
  // CSR roster (active isCsr only) — matched by NAME (FR IDs are unreliable across offices / ghost accounts).
  const csrs = await prisma.csrEmployee.findMany({ where: { isCsr: true, active: true }, select: { name: true }, distinct: ['name'] });
  const getCSR = pmMatcher([...new Set(csrs.map(c => c.name))]);
  const empMap = new Map<string, string>();
  const results = [];
  for (const o of offices) results.push(await syncOffice(o, since, empMap, getPM, getCSR));
  return { ok: true, since, results };
}
