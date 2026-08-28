// Syncs FR "Closed-Out" (template-86) marker forms into the closeout_forms cache table, so the closeout-
// detection systems can check the DB instead of making slow per-customer FR calls.
//
// For each office, it finds customers with a recent CO-type appointment (the only customers that could be
// closed out), then per-customer fetches their template-86 forms and upserts them. Serialized + throttled.
// Fire-and-forget by default (the per-customer form lookups exceed a cron scheduler's request timeout).
//   /api/cron/closeout-forms-sync?token=critterstop2026            (fire-and-forget, all offices)
//   /api/cron/closeout-forms-sync?token=critterstop2026&office=DFW (one office)
//   /api/cron/closeout-forms-sync?token=critterstop2026&wait=1     (wait for result summary)
//   /api/cron/closeout-forms-sync?token=critterstop2026&days=45    (lookback window for CO appts; default 21)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CLOSEOUT_FORM_TEMPLATE_ID } from '@/lib/closeout';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

// CO-type service IDs — the only customers that could have a closeout (matches the detection systems).
const CO_TYPE_IDS = new Set([504, 636, 1076, 615, 671, 546, 554, 620, 533, 538]);

// Serialized FR fetch (single promise chain, 1.1s spacing) — same robust throttle as closeout-daily.
let frChain: Promise<any> = Promise.resolve();
function frFetch(url: string): Promise<any> {
  const run = frChain.then(async () => {
    await new Promise(r => setTimeout(r, 1100));
    const r = await fetch(url);
    return r.json();
  });
  frChain = run.catch(() => {});
  return run;
}
function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }
async function fetchApptsByIds(ids: number[], key: string, token: string): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const data = await frFetch(`${BASE_URL}/appointment/get?appointmentIDs=${idParam}&authenticationKey=${key}&authenticationToken=${token}`);
    if (Array.isArray(data.appointments)) out.push(...data.appointments);
  }
  return out;
}

async function runSync(offices: string[], lookbackDays: number) {
  const results: any[] = [];
  for (const officeName of offices) {
    const cfg = OFFICES[officeName];
    if (!cfg?.key) continue;
    const end = new Date();
    const start = new Date(Date.now() - lookbackDays * 86400000);

    // 1) Recent completed appts in this office → the customers who might be closed out.
    const search = await frFetch(`${BASE_URL}/appointment/search?officeIDs=${cfg.officeId}&dateStart=${fmtDate(start)}&dateEnd=${fmtDate(end)}&status=1&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`);
    const apptIds: number[] = search.appointmentIDs || [];
    const appts = apptIds.length ? await fetchApptsByIds(apptIds, cfg.key, cfg.token) : [];
    const coCustomerIds = [...new Set(appts
      .filter(a => CO_TYPE_IDS.has(parseInt(String(a.type || a.serviceTypeID || '0'))))
      .map(a => String(a.customerID)).filter(x => x && x !== '0'))];

    // 2) Per-customer: fetch template-86 forms, upsert into the cache.
    let formsFound = 0;
    for (const custId of coCustomerIds) {
      const fs = await frFetch(`${BASE_URL}/form/search?customerID=${custId}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`);
      const ids: any[] = fs?.contractIDs || fs?.formIDs || [];
      if (!ids.length) continue;
      const idParam = ids.length === 1 ? `${ids[0]},${ids[0]}` : ids.join(',');
      const fg = await frFetch(`${BASE_URL}/form/get?contractIDs=${idParam}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`);
      const forms: any[] = (fg?.forms || fg?.contracts || []).filter((f: any) => parseInt(String(f.formTemplateID)) === CLOSEOUT_FORM_TEMPLATE_ID);
      for (const f of forms) {
        const dateAdded = new Date(f.dateAdded);
        if (isNaN(dateAdded.getTime())) continue;
        await prisma.closeoutForm.upsert({
          where: { formId: String(f.formID || f.contractID) },
          create: { office: officeName, customerId: custId, formId: String(f.formID || f.contractID), formTemplateId: CLOSEOUT_FORM_TEMPLATE_ID, documentState: f.documentState || null, dateAdded },
          update: { documentState: f.documentState || null, dateAdded },
        }).catch(() => {});
        formsFound++;
      }
    }
    results.push({ office: officeName, coCustomers: coCustomerIds.length, closeoutFormsUpserted: formsFound });
  }
  return results;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== process.env.CRON_SECRET && sp.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const officeParam = sp.get('office');
  const offices = officeParam ? [officeParam] : Object.keys(OFFICES);
  const lookbackDays = parseInt(sp.get('days') || '21');
  const wait = sp.get('wait') === '1';

  if (!wait) {
    runSync(offices, lookbackDays).catch(e => console.error('closeout-forms-sync bg error:', e));
    return NextResponse.json({ ok: true, started: true, offices, lookbackDays, note: 'Running in background. Add &wait=1 for results.' });
  }
  const results = await runSync(offices, lookbackDays);
  return NextResponse.json({ ok: true, results });
}
