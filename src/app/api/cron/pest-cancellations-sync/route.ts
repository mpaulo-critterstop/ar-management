// Pull CANCELED pest subscriptions from FieldRoutes (subscription/search by dateCancelled) and upsert into
// pest_cancellations. Pest subscriptions only (same classifier as pest sales). Powers the Cancellations
// module (churn report + win-back list). Read-from-FR / write-to-our-DB only.
//
//   /api/cron/pest-cancellations-sync?token=critterstop2026&since=2026-01-01&office=All   &wait=1
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { classifyPestCommission } from '@/lib/pestCommission';
import { bucketCancelReason } from '@/lib/cancelReasons';
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

async function frGet(endpoint: string, params: string, key: string, token: string) {
  const res = await fetch(`${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return res.json();
}
const toDate = (d: string) => (d && !d.startsWith('0000')) ? new Date(d.replace(' ', 'T')) : null;
const monthKey = (d: string) => (d && !d.startsWith('0000')) ? d.slice(0, 7) : null;

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

async function syncOffice(office: string, since: string, empMap: Map<string, string>) {
  const cfg = OFFICES[office];
  if (!cfg?.key) return { office, error: 'unconfigured' };
  const catalog = await loadCatalog(cfg);

  // Search subscriptions canceled in the window.
  const range = JSON.stringify({ operator: 'BETWEEN', value: [`${since} 00:00:00`, '2027-12-31 23:59:59'] });
  const search = await frGet('subscription/search', `dateCancelled=${encodeURIComponent(range)}`, cfg.key, cfg.token);
  const ids: number[] = search?.subscriptionIDs || [];
  if (!ids.length) return { office, canceled: 0, pestUpserted: 0 };

  const subs: any[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const r = await frGet('subscription/get', `subscriptionIDs=${idParam}`, cfg.key, cfg.token);
    (r?.subscriptions || []).forEach((s: any) => subs.push(s));
    await new Promise(res => setTimeout(res, 150));
  }

  // Resolve employee names (cancelledBy + soldBy) and customer contact.
  const empIds = [...new Set(subs.flatMap(s => [String(s.cancelledBy), String(s.soldBy)]).filter(x => x && x !== '0'))].filter(id => !empMap.has(id));
  if (empIds.length) {
    const r = await frGet('employee/get', `employeeIDs=${empIds.join(',')}`, cfg.key, cfg.token);
    (r?.employees || []).forEach((e: any) => empMap.set(String(e.employeeID), `${e.fname || ''} ${e.lname || ''}`.trim()));
  }
  const custIds = [...new Set(subs.map(s => String(s.customerID)))];
  const custInfo = new Map<string, { name: string; phone: string; email: string }>();
  for (let i = 0; i < custIds.length; i += 1000) {
    const r = await frGet('customer/get', `customerIDs=${custIds.slice(i, i + 1000).join(',')}`, cfg.key, cfg.token);
    (r?.customers || []).forEach((c: any) => custInfo.set(String(c.customerID), {
      name: `${c.fname || ''} ${c.lname || ''}`.trim() || c.companyName || '',
      phone: c.phone1 || c.phone2 || c.cellPhone || '',
      email: c.email || '',
    }));
    await new Promise(res => setTimeout(res, 100));
  }

  let pestUpserted = 0, skippedNonPest = 0;
  for (const s of subs) {
    const sid = String(s.serviceID);
    if (EXCLUDE_SERVICEIDS.has(sid)) { skippedNonPest++; continue; }
    const cat = catalog.get(sid);
    const frCategory = cat?.category || '';
    const name = cat?.name || s.serviceType || `#${sid}`;
    // Pest-only. Mole/OLT (Wildlife, no-contract, one-time) are NOT pest churn — skip them here (they
    // classify as EXCLUDE via the pest classifier since Wildlife isn't Pest Control/Termite).
    const commCat = classifyPestCommission(frCategory, name);
    if (commCat === 'EXCLUDE') { skippedNonPest++; continue; }

    const dAdded = toDate(s.dateAdded);
    const dCanc = toDate(s.dateCancelled);
    const tenureDays = (dAdded && dCanc) ? Math.round((dCanc.getTime() - dAdded.getTime()) / 86400000) : null;
    const reason = bucketCancelReason(s.cxlNotes);
    const cust = custInfo.get(String(s.customerID));

    await prisma.pestCancellation.upsert({
      where: { externalKey: `${office}:${s.subscriptionID}` },
      create: {
        office, subscriptionId: String(s.subscriptionID), externalKey: `${office}:${s.subscriptionID}`,
        customerId: String(s.customerID), customerName: cust?.name || null, customerPhone: cust?.phone || null, customerEmail: cust?.email || null,
        serviceId: sid, serviceType: s.serviceType || name, category: commCat,
        contractValue: Number(s.contractValue) || 0, recurringCharge: Number(s.recurringCharge) || 0,
        annualRecurringValue: Number(s.annualRecurringValue) || 0,
        dateAdded: dAdded, dateCancelled: dCanc, tenureDays,
        cancelReasonRaw: reason.cleaned || null, cancelReasonBucket: reason.bucket,
        cancelledByFrId: String(s.cancelledBy) || null, cancelledByName: empMap.get(String(s.cancelledBy)) || null,
        soldByFrId: String(s.soldBy) || null, cancelMonth: monthKey(s.dateCancelled),
      },
      update: {
        customerName: cust?.name || null, customerPhone: cust?.phone || null, customerEmail: cust?.email || null,
        serviceType: s.serviceType || name, category: commCat,
        contractValue: Number(s.contractValue) || 0, recurringCharge: Number(s.recurringCharge) || 0,
        annualRecurringValue: Number(s.annualRecurringValue) || 0,
        dateAdded: dAdded, dateCancelled: dCanc, tenureDays,
        cancelReasonRaw: reason.cleaned || null, cancelReasonBucket: reason.bucket,
        cancelledByName: empMap.get(String(s.cancelledBy)) || null, cancelMonth: monthKey(s.dateCancelled),
      },
    });
    pestUpserted++;
  }
  return { office, canceled: subs.length, pestUpserted, skippedNonPest };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const since = sp.get('since') || '2026-01-01';
  const officeParam = sp.get('office') || 'All';
  const offices = officeParam === 'All' ? Object.keys(OFFICES) : [officeParam];

  if (sp.get('wait') === '1') {
    const result = await run(since, offices);
    return NextResponse.json(result);
  }
  waitUntil(run(since, offices).catch(e => { console.error('pest-cancellations-sync error:', e); }));
  return NextResponse.json({ ok: true, started: true, since, offices, note: 'Running in background. Use ?wait=1 for inline result.' });
}

async function run(since: string, offices: string[]) {
  const empMap = new Map<string, string>();
  const results = [];
  for (const o of offices) results.push(await syncOffice(o, since, empMap));
  return { ok: true, since, results };
}
