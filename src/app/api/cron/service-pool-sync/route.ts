// Build the Service Pool: active pest/termite subscriptions DUE for service (lastCompleted + frequency)
// that have NO pending (status=0) future appointment in FR. Snapshot-style: rebuilt each run per office.
//   /api/cron/service-pool-sync?token=critterstop2026&office=All   &wait=1   &horizon=120
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
const EXCLUDE_SERVICEIDS = new Set(['836', '1077']);

async function frGet(ep: string, params: string, key: string, token: string) {
  const r = await fetch(`${FR_BASE}/${ep}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return r.json();
}
// FR dates are Central-local; parse to a UTC instant correctly (CST/CDT aware).
function toCentral(d: string | null | undefined): Date | null {
  if (!d || d.startsWith('0000')) return null;
  const m = d.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, day, h, mi, se] = m.map((v, i) => i === 0 ? v : Number(v)) as any;
  const probe = new Date(Date.UTC(y, mo - 1, day, h || 0, mi || 0, se || 0));
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' })
    .formatToParts(probe).find(p => p.type === 'timeZoneName')?.value || 'CST';
  return new Date(Date.UTC(y, mo - 1, day, (h || 0) + (tz.includes('DT') ? 5 : 6), mi || 0, se || 0));
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

async function syncOffice(office: string, horizonDays: number) {
  const cfg = OFFICES[office];
  if (!cfg?.key) return { office, error: 'unconfigured' };
  const catalog = await loadCatalog(cfg);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // 1) Pending future appointments -> set of subscription IDs that ARE already scheduled.
  // FR's appointment/search caps results (~1000), so a single wide search silently truncates — missing
  // scheduled subs and inflating the pool. Page it in ~3-week date chunks out to the horizon so each
  // search stays under the cap.
  const scheduledSubs = new Set<string>();
  let apptSearchCount = 0;
  const chunkDiag: any[] = [];
  const horizonEnd = new Date(today.getTime() + 400 * 86400000);
  // Appointments cluster heavily in the next ~4 weeks (FR generates ~a month out) and a single 3-week
  // window already exceeds FR's ~1000 search cap. So chunk by 7 days — small enough to stay under the cap
  // where density is high; sparse far-future windows are cheap.
  const STEP = 7 * 86400000;
  for (let ws = new Date(today); ws < horizonEnd; ws = new Date(ws.getTime() + STEP)) {
    const we = new Date(Math.min(ws.getTime() + STEP, horizonEnd.getTime()));
    const fromS = ws.toISOString().slice(0, 10), toS = we.toISOString().slice(0, 10);
    const chunk = JSON.stringify({ operator: 'BETWEEN', value: [fromS, toS] });
    const srch = await frGet('appointment/search', `date=${encodeURIComponent(chunk)}`, cfg.key, cfg.token);
    const chunkIds: number[] = srch?.appointmentIDs || [];
    apptSearchCount += chunkIds.length;
    if (chunkIds.length >= 1000) chunkDiag.push({ from: fromS, to: toS, count: chunkIds.length, CAPPED: true });
    for (let i = 0; i < chunkIds.length; i += 1000) {
      const got = await frGet('appointment/get', `appointmentIDs=${chunkIds.slice(i, i + 1000).join(',')}`, cfg.key, cfg.token);
      for (const a of (got?.appointments || [])) {
        if (String(a.status) === '0') scheduledSubs.add(String(a.subscriptionID));
      }
      await new Promise(r => setTimeout(r, 80));
    }
  }

  // 2) Active subscriptions (dateCancelled empty => active). Search a wide dateAdded range to get all.
  // Active subscriptions: use the proven BETWEEN dateAdded search (no 'active' search param — we filter
  // active in-code below by active flag + empty dateCancelled). Wide range to capture all.
  const addedRange = JSON.stringify({ operator: 'BETWEEN', value: ['2015-01-01 00:00:00', '2027-12-31 23:59:59'] });
  const subSearch = await frGet('subscription/search', `dateAdded=${encodeURIComponent(addedRange)}`, cfg.key, cfg.token);
  const subIds: number[] = subSearch?.subscriptionIDs || [];
  // If the subscription search came back empty, capture WHY (rate limit / error) rather than silently
  // proceeding with an empty pool.
  const subSearchDiag = subIds.length === 0 ? {
    success: subSearch?.success, errorMessage: subSearch?.errorMessage || subSearch?.error || null,
    tokenUsage: subSearch?.tokenUsage, keys: subSearch && typeof subSearch === 'object' ? Object.keys(subSearch) : null,
  } : null;

  const rows: any[] = [];
  const custIdsNeeded = new Set<string>();
  const staged: any[] = [];
  let onHoldSkipped = 0;
  for (let i = 0; i < subIds.length; i += 1000) {
    const got = await frGet('subscription/get', `subscriptionIDs=${subIds.slice(i, i + 1000).join(',')}`, cfg.key, cfg.token);
    for (const s of (got?.subscriptions || [])) {
      if (String(s.active) !== '1') continue;                       // active only
      if (String(s.onHold) === '1') { onHoldSkipped++; continue; }  // on-hold = intentionally paused, not "due"
      if (s.dateCancelled && !String(s.dateCancelled).startsWith('0000')) continue;
      if (scheduledSubs.has(String(s.subscriptionID))) continue;    // already scheduled -> not in pool
      const sid = String(s.serviceID);
      if (EXCLUDE_SERVICEIDS.has(sid)) continue;
      const cat = catalog.get(sid);
      const commCat = classifyPestCommission(cat?.category || '', cat?.name || s.serviceType || '');
      if (commCat === 'EXCLUDE') continue;                          // pest + termite only (classifier)
      const freq = Number(s.frequency) || 0;
      const last = toCentral(s.lastCompleted);
      if (!last || freq <= 0) continue;                             // need both to compute a due date
      const due = new Date(last.getTime() + freq * 86400000);
      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000);
      staged.push({ s, sid, cat, commCat, freq, last, due, daysOverdue });
      custIdsNeeded.add(String(s.customerID));
    }
    await new Promise(r => setTimeout(r, 120));
  }

  // Customer contact lookup.
  const custInfo = new Map<string, { name: string; phone: string }>();
  const custArr = [...custIdsNeeded];
  for (let i = 0; i < custArr.length; i += 1000) {
    const r = await frGet('customer/get', `customerIDs=${custArr.slice(i, i + 1000).join(',')}`, cfg.key, cfg.token);
    (r?.customers || []).forEach((c: any) => custInfo.set(String(c.customerID), {
      name: `${c.fname || ''} ${c.lname || ''}`.trim() || c.companyName || '', phone: c.phone1 || c.cellPhone || '',
    }));
    await new Promise(r2 => setTimeout(r2, 100));
  }

  for (const it of staged) {
    const cust = custInfo.get(String(it.s.customerID));
    rows.push({
      office, subscriptionId: String(it.s.subscriptionID), externalKey: `${office}:${it.s.subscriptionID}`,
      customerId: String(it.s.customerID), customerName: cust?.name || null, customerPhone: cust?.phone || null,
      serviceId: it.sid, serviceType: it.cat?.name || it.s.serviceType || null, category: it.commCat,
      frequencyDays: it.freq, lastCompleted: it.last, dueDate: it.due,
      daysOverdue: it.daysOverdue, isOverdue: it.daysOverdue > 0,
      contractValue: Number(it.s.contractValue) || 0, recurringCharge: Number(it.s.recurringCharge) || 0,
    });
  }

  // Snapshot: replace this office's pool.
  await prisma.servicePoolItem.deleteMany({ where: { office } });
  for (let i = 0; i < rows.length; i += 200) {
    await prisma.servicePoolItem.createMany({ data: rows.slice(i, i + 200), skipDuplicates: true });
  }
  return { office, activeSubsScanned: subIds.length, apptSearchCount, scheduled: scheduledSubs.size, onHoldSkipped, pooled: rows.length,
    overdue: rows.filter(r => r.isOverdue).length, chunkDiag, ...(subSearchDiag ? { subSearchDiag } : {}) };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const officeParam = sp.get('office') || 'All';
  const offices = officeParam === 'All' ? Object.keys(OFFICES) : [officeParam];
  const horizon = Number(sp.get('horizon')) || 120;

  if (sp.get('wait') === '1') return NextResponse.json(await run(offices, horizon));
  waitUntil(run(offices, horizon).catch(e => console.error('service-pool-sync error:', e)));
  return NextResponse.json({ ok: true, started: true, offices, note: 'Running in background. Use ?wait=1 for inline result.' });
}
async function run(offices: string[], horizon: number) {
  const results = [];
  for (const o of offices) results.push(await syncOffice(o, horizon));
  return { ok: true, results };
}
