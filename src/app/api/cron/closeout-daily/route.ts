// Daily close-out % digest for DFW → Slack at 7am (reports YESTERDAY).
// Self-contained: fetches from FieldRoutes directly, carries its own copy of the CO-job logic (lifted from
// tc-accountability/field-performance), and has NO dependency on the Field Performance module running.
//
// CO job (denominator) = a completed appointment that is:
//   • a Call Back (615, 671, 546, 554, 620) or Annual Inspection (533, 538)  → always, OR
//   • a Trap Check (504, 636) → ONLY if the customer had a PRIOR trap check before this appt's date
//     (i.e. this is their 2nd+ TC; the first TC on an account is not a close-out opportunity)
// Closed out (numerator) = the appt's office/tech notes contain a closeout keyword.
// Close-out % = closed out ÷ CO jobs.
//
//   /api/cron/closeout-daily?token=critterstop2026          (live: posts to Slack, reports yesterday)
//   /api/cron/closeout-daily?token=critterstop2026&dry=1     (preview JSON, posts nothing)
//   /api/cron/closeout-daily?token=critterstop2026&date=2026-08-24  (report a specific day)
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW!, officeId: 1 },
};

const TRAP_CHECK_IDS = new Set([504, 636]);
const OTHER_CO_IDS    = new Set([615, 671, 546, 554, 620, 533, 538]); // call backs + annual inspections
const CLOSEOUT_KEYWORDS = ['ready for insulation', 'ready for far', 'closed out'];

function frUrl(endpoint: string, action: string, params: Record<string, string>, key: string, token: string) {
  const url = new URL(`${BASE_URL}/${endpoint}/${action}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('authenticationKey', key);
  url.searchParams.set('authenticationToken', token);
  return url.toString();
}
let lastFrCall = 0;
async function frFetch(url: string) {
  // Global throttle: FR rate-limits at 60 reads/min. Space calls ~1.1s apart so the per-customer prior-TC
  // lookups don't hit the limit (which was causing coJobs to vary run-to-run as some lookups silently failed).
  const wait = 1100 - (Date.now() - lastFrCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFrCall = Date.now();
  const r = await fetch(url);
  return r.json();
}
async function fetchApptsByIds(ids: number[], key: string, token: string): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    // pad single-id (FR quirk: a lone id can return empty)
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const data = await frFetch(frUrl('appointment', 'get', { appointmentIDs: idParam }, key, token));
    if (Array.isArray(data.appointments)) out.push(...data.appointments);
  }
  return out;
}
function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }
function hasCloseoutNote(appt: any): boolean {
  const text = [appt.officeNotes, appt.techNotes, appt.notes].filter(Boolean).join(' ').toLowerCase();
  return CLOSEOUT_KEYWORDS.some(k => text.includes(k));
}

async function sendSlack(webhook: string, text: string, blocks?: any[]) {
  const body: any = { text };
  if (blocks) body.blocks = blocks;
  await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = sp.get('token');
  if (token !== process.env.CRON_SECRET && token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = sp.get('dry') === '1';
  const debugCust = sp.get('debugCust');
  const debugDay = sp.get('debugDay');
  const debugLookback = sp.get('debugLookback'); // test the prior-TC lookback search for one customer
  const cfgDbg = OFFICES.DFW;

  if (debugLookback && cfgDbg?.key) {
    const day = sp.get('day') || fmtDate(new Date(Date.now() - 86400000));
    const lookbackStart = fmtDate(new Date(new Date(day + 'T12:00:00Z').getTime() - 120 * 86400000));
    // exactly as the cron builds it, but for a single customer
    const s = await frFetch(frUrl('appointment', 'search', {
      officeIDs: '1', customerIDs: debugLookback, dateStart: lookbackStart, dateEnd: day, status: '1',
    }, cfgDbg.key, cfgDbg.token));
    const ids: number[] = s.appointmentIDs || [];
    const full = ids.length ? await fetchApptsByIds(ids, cfgDbg.key, cfgDbg.token) : [];
    const tcs = full.filter((a: any) => TRAP_CHECK_IDS.has(parseInt(String(a.type || a.serviceTypeID || '0'))));
    return NextResponse.json({
      debugLookback, lookbackStart, day,
      returnedIds: ids.length,
      trapChecks: tcs.map((a: any) => ({ id: a.appointmentID, date: a.date, type: a.type || a.serviceTypeID })),
    });
  }

  if (debugDay && cfgDbg?.key) {
    const base = { officeIDs: '1' };
    const a = await frFetch(frUrl('appointment', 'search', { ...base, dateStart: debugDay, dateEnd: debugDay, status: '1' }, cfgDbg.key, cfgDbg.token));
    const b = await frFetch(frUrl('appointment', 'search', { ...base, dateStart: debugDay, dateEnd: debugDay }, cfgDbg.key, cfgDbg.token));
    const c = await frFetch(frUrl('appointment', 'search', { ...base, dateCompletedStart: debugDay, dateCompletedEnd: debugDay }, cfgDbg.key, cfgDbg.token));
    return NextResponse.json({
      debugDay,
      withStatus_dateField: (a.appointmentIDs || []).length,
      noStatus_dateField: (b.appointmentIDs || []).length,
      dateCompleted_field: (c.appointmentIDs || []).length,
      target_209581_in_withStatus: (a.appointmentIDs || []).map(String).includes("209581"),
      target_209581_in_noStatus: (b.appointmentIDs || []).map(String).includes("209581"),
      target_209581_in_dateCompleted: (c.appointmentIDs || []).map(String).includes("209581"),
    });
  }

  if (debugCust && cfgDbg?.key) {
    // Show everything FR returns for this customer over a wide window — both search variants.
    const wide = { officeIDs: '1', customerIDs: debugCust, dateStart: '2026-06-01', dateEnd: '2026-08-27' };
    const withStatus = await frFetch(frUrl('appointment', 'search', { ...wide, status: '1' }, cfgDbg.key, cfgDbg.token));
    const noStatus = await frFetch(frUrl('appointment', 'search', wide, cfgDbg.key, cfgDbg.token));
    const ids = noStatus.appointmentIDs || [];
    const full = ids.length ? await fetchApptsByIds(ids, cfgDbg.key, cfgDbg.token) : [];
    return NextResponse.json({
      debugCust,
      search_withStatus_count: (withStatus.appointmentIDs || []).length,
      search_noStatus_count: ids.length,
      appts: full.map((a: any) => ({
        id: a.appointmentID, date: a.date, dateCompleted: a.dateCompleted, dateAdded: a.dateAdded,
        type: a.type || a.serviceTypeID, status: a.status, statusText: a.statusText,
        officeNotes: (a.officeNotes || '').substring(0, 120), techNotes: (a.techNotes || '').substring(0, 120),
        appointmentNotes: (a.appointmentNotes || '').substring(0, 200),
      })),
    });
  }

  // Target day = yesterday (Central-ish; we use date-only so time zone drift doesn't matter at day grain).
  // Allow ?date=YYYY-MM-DD override for testing.
  const dateParam = sp.get('date');
  const target = dateParam ? new Date(dateParam + 'T12:00:00Z') : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayStr = fmtDate(target);

  const cfg = OFFICES.DFW;
  if (!cfg?.key) return NextResponse.json({ error: 'DFW FR keys not configured' }, { status: 500 });

  // 1) Yesterday's completed appointments in DFW.
  const search = await frFetch(frUrl('appointment', 'search', {
    officeIDs: String(cfg.officeId),
    dateStart: dayStr,
    dateEnd: dayStr,
    status: '1', // completed
  }, cfg.key, cfg.token));
  const apptIds: number[] = search.appointmentIDs || [];
  const appts = apptIds.length ? await fetchApptsByIds(apptIds, cfg.key, cfg.token) : [];

  // Only completed appts, of a CO-relevant type.
  const completed = appts.filter(a => String(a.status) === '1');

  // 2) For trap-check appts, we need to know if the customer had a PRIOR trap check before this appt's date.
  //    Pull a 120-day lookback of each relevant customer's appointments and check for an earlier TC.
  const tcCandidates = completed.filter(a => TRAP_CHECK_IDS.has(parseInt(String(a.type || a.serviceTypeID || '0'))));
  const tcCustomerIds = [...new Set(tcCandidates.map(a => String(a.customerID)).filter(x => x && x !== '0'))];

  // 2) For trap-check appts, we need to know if the customer had a PRIOR trap check before this appt's date.
  //    Pull each TC customer's history individually — FR's appointment/search with many customerIDs joined
  //    together only honors one, so a bulk search silently drops all-but-one customer. Per-customer is
  //    reliable (throttled lightly to respect FR rate limits).
  const priorTcByCustomer = new Map<string, Date[]>();
  if (tcCustomerIds.length) {
    const lookbackStart = fmtDate(new Date(target.getTime() - 120 * 24 * 60 * 60 * 1000));
    for (const custId of tcCustomerIds) {
      const histSearch = await frFetch(frUrl('appointment', 'search', {
        officeIDs: String(cfg.officeId),
        customerIDs: custId,
        dateStart: lookbackStart,
        dateEnd: dayStr,
      }, cfg.key, cfg.token));
      const histIds: number[] = histSearch.appointmentIDs || [];
      if (!histIds.length) continue;
      const hist = await fetchApptsByIds(histIds, cfg.key, cfg.token);
      for (const h of hist) {
        if (String(h.status) !== '1') continue;
        const tId = parseInt(String(h.type || h.serviceTypeID || '0'));
        if (!TRAP_CHECK_IDS.has(tId)) continue;
        const d = new Date(h.date || h.dateAdded);
        if (!priorTcByCustomer.has(custId)) priorTcByCustomer.set(custId, []);
        priorTcByCustomer.get(custId)!.push(d);
      }
    }
  }

  // 3) Classify each completed appt as CO job / closed out.
  let coJobs = 0, closedOut = 0;
  const coDetail: any[] = [];
  const techTally = new Map<string, { co: number; closed: number }>();
  for (const a of completed) {
    const typeId = parseInt(String(a.type || a.serviceTypeID || '0'));
    let isCoJob = false;
    if (OTHER_CO_IDS.has(typeId)) {
      isCoJob = true;
    } else if (TRAP_CHECK_IDS.has(typeId)) {
      // Prior TC before THIS appointment's date?
      const cust = String(a.customerID);
      const thisDate = new Date(a.date || a.dateAdded).getTime();
      const priors = priorTcByCustomer.get(cust) || [];
      isCoJob = priors.some(d => d.getTime() < thisDate);
    }
    if (!isCoJob) continue;
    coJobs++;
    const co = hasCloseoutNote(a);
    if (co) closedOut++;
    // Per-tech tally, attributed to the tech who did the visit (servicedBy; fallback assignedTech).
    const techId = String(a.servicedBy && a.servicedBy !== '0' ? a.servicedBy : (a.assignedTech || '0'));
    if (!techTally.has(techId)) techTally.set(techId, { co: 0, closed: 0 });
    const tt = techTally.get(techId)!;
    tt.co++;
    if (co) tt.closed++;
    coDetail.push({ customer: a.customerName || a.customerID, type: typeId, closedOut: co, tech: techId });
  }

  const pct = coJobs > 0 ? Math.round((closedOut / coJobs) * 1000) / 10 : null;

  // Resolve tech IDs -> names for the per-tech breakdown.
  const techIds = [...techTally.keys()].filter(id => id && id !== '0');
  const techNames = new Map<string, string>();
  if (techIds.length) {
    const idParam = techIds.length === 1 ? `${techIds[0]},${techIds[0]}` : techIds.join(',');
    const er = await frFetch(frUrl('employee', 'get', { employeeIDs: idParam }, cfg.key, cfg.token));
    for (const e of (er?.employees || [])) techNames.set(String(e.employeeID), `${e.fname || ''} ${e.lname || ''}`.trim());
  }
  const byTech = [...techTally.entries()]
    .map(([id, t]) => ({ tech: techNames.get(id) || `#${id}`, co: t.co, closed: t.closed, pct: t.co > 0 ? Math.round((t.closed / t.co) * 1000) / 10 : 0 }))
    .sort((a, b) => b.co - a.co);

  if (dry) {
    return NextResponse.json({ dry: true, date: dayStr, office: 'DFW', coJobs, closedOut, closeOutPct: pct,
      byTech, detail: coDetail.slice(0, 100) });
  }

  const webhook = process.env.SLACK_CLOSEOUT_WEBHOOK_URL || process.env.SLACK_TC_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return NextResponse.json({ error: 'No Slack webhook configured' }, { status: 500 });

  const prettyDate = target.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const techLines = byTech.map(t => `• *${t.tech}* — ${t.closed}/${t.co} closed out (${t.pct}%)`).join('\n') || '_No close-out jobs._';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📋 DFW Close-Out Report — ${prettyDate}`, emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Close-out jobs:*\n${coJobs}` },
      { type: 'mrkdwn', text: `*Closed out:*\n${closedOut}` },
      { type: 'mrkdwn', text: `*Close-out %:*\n${pct != null ? pct + '%' : '—'}` },
    ] },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*By tech:*\n${techLines}` } },
  ];
  await sendSlack(webhook, `DFW Close-Out ${prettyDate}: ${closedOut}/${coJobs} (${pct != null ? pct + '%' : '—'})`, blocks);
  return NextResponse.json({ ok: true, date: dayStr, coJobs, closedOut, closeOutPct: pct, posted: true });
}
