// SAFE probe: does FR expose a payment WRITE endpoint on our key, and what does it expect?
// Strategy: call payment/create (and a couple of likely names) with NO/invalid params. FR returns a descriptive
// error that reveals (a) whether the endpoint/action exists, (b) whether our key has write permission, and
// (c) the required fields — WITHOUT creating a real payment. We never pass a real amount/customer, so nothing
// is committed. Also reports the key's write-quota fields (proves write capability is provisioned).
//   /api/cron/.. no — debug route: /api/debug/fr-payment-write-probe?token=critterstop2026&office=DFW
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cfg = OFFICES[sp.get('office') || 'DFW'];
  if (!cfg?.key) return NextResponse.json({ error: 'bad office' }, { status: 400 });
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

  const results: any = {};

  // 1) Baseline: a READ call that returns token usage/limits (shows write quota is provisioned).
  try {
    const r = await fetch(`${BASE}/payment/search?${auth}&dateUpdatedStart=2099-01-01&dateUpdatedEnd=2099-01-02`);
    const j = await r.json();
    results.tokenUsage = j.tokenUsage;
    results.tokenLimits = j.tokenLimits;
    results.apiKeyType = j.requestAPIKeyType;
  } catch (e: any) { results.baselineError = String(e).slice(0, 200); }

  // 2) Probe write actions with NO real data (empty/invalid params). Reads the error to learn existence + fields.
  //    We intentionally send NOTHING chargeable — no amount, no customerID — so nothing can be created.
  const probes = ['payment/create', 'payment/add', 'payment/insert'];
  results.writeProbes = {};
  for (const ep of probes) {
    try {
      const r = await fetch(`${BASE}/${ep}?${auth}`); // no payment params at all
      const text = await r.text();
      let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 400); }
      results.writeProbes[ep] = {
        httpStatus: r.status,
        success: parsed?.success,
        errorMessage: parsed?.errorMessage || parsed?.error || undefined,
        // surface anything that hints at required fields / permission
        raw: typeof parsed === 'string' ? parsed : JSON.stringify(parsed).slice(0, 500),
      };
    } catch (e: any) { results.writeProbes[ep] = { fetchError: String(e).slice(0, 200) }; }
  }

  // 3) INCREMENTAL FIELD DISCOVERY — build up params from a base, reading each "X required" error.
  //    We pass doCharge=0 (record-only, NO card charge) and deliberately OMIT a real amount/customer until we
  //    know the full field list. We stop BEFORE sending a complete chargeable/recordable payload.
  if (sp.get('discover') === '1') {
    const steps: any[] = [];
    // progressively add fields the error asks for; start minimal with doCharge=0
    const attempts: Record<string, string>[] = [
      { doCharge: '0' },
      { doCharge: '0', customerID: '0' },                                   // invalid customer on purpose
      { doCharge: '0', customerID: '0', amount: '0' },                      // zero amount on purpose
      { doCharge: '0', customerID: '0', amount: '0', paymentMethod: '0' },
      { doCharge: '0', customerID: '0', amount: '0', paymentMethod: '1', checkNumber: '' },
    ];
    for (const a of attempts) {
      const qs = Object.entries(a).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const r = await fetch(`${BASE}/payment/create?${auth}&${qs}`);
      const t = await r.text(); let p: any; try { p = JSON.parse(t); } catch { p = t.slice(0, 300); }
      steps.push({ sent: a, success: p?.success, errorMessage: p?.errorMessage, paymentID: p?.paymentID });
      // if it ever reports success, STOP (shouldn't, with customerID=0/amount=0)
      if (p?.success) break;
    }
    return NextResponse.json({ note: 'Field discovery with doCharge=0 and invalid/zero customer+amount — nothing valid was created. Each step shows the next required/invalid field.', steps });
  }

  return NextResponse.json({
    note: 'Safe probe — no payment params sent, so nothing was created. Reading endpoint existence + write quota + error shapes only.',
    office: sp.get('office') || 'DFW',
    ...results,
  });
}
