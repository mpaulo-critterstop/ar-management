// READ-ONLY DIAGNOSTIC — inspect what cancellation data FieldRoutes exposes on the subscription object.
// Does NOT write anything. Use it to see real field names/values before building a churn/win-back feature.
//
//   /api/cron/fr-cancel-probe?token=critterstop2026&office=DFW&since=2026-06-01
//   &sample=3   how many full records to dump (default 3)
//
// Tries two things:
//   1) subscription/search filtered by dateCancelled in [since, now] — tells us if FR supports that filter
//      and how many canceled subs exist in the window.
//   2) subscription/get on a few of them — dumps the RAW field set so we can see dateCancelled,
//      cancellation reason, status flags, etc. exactly as this tenant returns them.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

async function frGet(endpoint: string, params: string, key: string, token: string) {
  const res = await fetch(`${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, body: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, body: text.slice(0, 500) }; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const since = sp.get('since') || '2026-06-01';
  const sample = Math.min(Number(sp.get('sample')) || 3, 10);
  const cfg = OFFICES[office];
  if (!cfg) return NextResponse.json({ error: 'unknown office', offices: Object.keys(OFFICES) }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const range = JSON.stringify({ operator: 'BETWEEN', value: [since, today] });

  // 1) Try searching by dateCancelled — this confirms FR supports the filter and counts cancels in-window.
  const searchByCancel = await frGet('subscription/search', `dateCancelled=${encodeURIComponent(range)}`, cfg.key, cfg.token);

  // Fallback probe: some tenants use a different field/flag. Also try 'active' flag search for reference.
  let ids: number[] = searchByCancel.body?.subscriptionIDs || [];
  const out: any = {
    office, since, today,
    searchByCancel: { ok: searchByCancel.ok, status: searchByCancel.status, count: ids.length,
      keysReturned: searchByCancel.body && typeof searchByCancel.body === 'object' ? Object.keys(searchByCancel.body) : null,
      rawIfError: ids.length === 0 ? searchByCancel.body : undefined },
  };

  // 2) Dump raw fields for a few canceled subscriptions so we see the real shape.
  if (ids.length > 0) {
    const idParam = encodeURIComponent(JSON.stringify(ids.slice(0, sample)));
    const got = await frGet('subscription/get', `subscriptionIDs=${idParam}`, cfg.key, cfg.token);
    const subs = got.body?.subscriptions || [];
    out.sampleCount = subs.length;
    // Field inventory across the sample (union of all keys), + the full raw records.
    const allKeys = new Set<string>();
    for (const s of subs) Object.keys(s).forEach(k => allKeys.add(k));
    out.allFieldNames = [...allKeys].sort();
    // Highlight the cancellation-relevant fields if present.
    const CANCEL_HINTS = [...allKeys].filter(k => /cancel|cxl|active|status|reason|note|dateUpdated|inactive|hold|expir|renewal/i.test(k));
    out.cancellationRelevantFields = CANCEL_HINTS;
    out.rawSample = subs.map((s: any) => {
      const picked: any = {};
      for (const k of CANCEL_HINTS) picked[k] = s[k];
      // plus a few identity fields for context
      for (const k of ['subscriptionID', 'customerID', 'serviceID', 'serviceType', 'dateAdded', 'contractValue']) picked[k] = s[k];
      return picked;
    });
    out.fullFirstRecord = subs[0] || null; // entire raw object of the first, to catch anything we didn't anticipate
  }

  // Reason fill-rate: pull a larger batch and measure how often cxlNotes is populated (tells us whether
  // churn-BY-REASON is viable, or only churn counts/values).
  if (ids.length > 0) {
    const batch = ids.slice(0, Math.min(ids.length, 100));
    const idParam = encodeURIComponent(JSON.stringify(batch));
    const got = await frGet('subscription/get', `subscriptionIDs=${idParam}`, cfg.key, cfg.token);
    const subs = got.body?.subscriptions || [];
    let withNotes = 0;
    const sampleNotes: string[] = [];
    for (const s of subs) {
      const note = (s.cxlNotes || '').toString().trim();
      if (note) { withNotes++; if (sampleNotes.length < 8) sampleNotes.push(note.slice(0, 80)); }
    }
    out.reasonFillRate = { checked: subs.length, withCxlNotes: withNotes,
      pct: subs.length ? Math.round((withNotes / subs.length) * 100) : 0, sampleNotes };
  }

  return NextResponse.json(out);
}
