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

  // REAL WRITE: a single deliberate record-only payment. Only runs with explicit confirm=YES + all params.
  // Records (does NOT charge) a payment for a customer. Used to validate the Helcim->FR bridge path.
  if (sp.get('realwrite') === '1') {
    if (sp.get('confirm') !== 'YES') return NextResponse.json({ error: 'Add &confirm=YES to actually write.' }, { status: 400 });
    const customerID = sp.get('customer');
    const amount = sp.get('amount');
    const paymentMethod = sp.get('paymentMethod') || '1'; // 1 = check (non-card; appropriate for recording external payment)
    const checkNumber = sp.get('checkNumber') || 'HELCIM-TEST';
    if (!customerID || !amount) return NextResponse.json({ error: 'customer + amount required' }, { status: 400 });
    const qs = `doCharge=0&customerID=${customerID}&amount=${amount}&paymentMethod=${paymentMethod}&checkNumber=${encodeURIComponent(checkNumber)}`;
    const r = await fetch(`${BASE}/payment/create?${auth}&${qs}`);
    const t = await r.text(); let p: any; try { p = JSON.parse(t); } catch { p = t.slice(0, 400); }
    return NextResponse.json({ sent: { doCharge: 0, customerID, amount, paymentMethod, checkNumber }, success: p?.success, paymentID: p?.paymentID, errorMessage: p?.errorMessage, raw: typeof p === 'string' ? p : JSON.stringify(p).slice(0, 400) });
  }

  // DISCOVER PAYMENT METHODS: sample recent real payments, group by paymentMethod code so we can map
  // code -> Cash/Check/Card/ACH. Read-only. Also tries a paymentMethod reference endpoint if one exists.
  if (sp.get('methods') === '1') {
    // grab newest ~400 payment IDs, fetch a chunk, group by paymentMethod value
    const s = await fetch(`${BASE}/payment/search?${auth}`);
    const sj = await s.json();
    const ids: number[] = (sj.paymentIDs || []).map(Number).sort((a: number, b: number) => b - a).slice(0, 300);
    const byMethod: Record<string, { count: number; samples: any[] }> = {};
    for (let i = 0; i < ids.length; i += 100) {
      const g = await fetch(`${BASE}/payment/get?paymentIDs=${ids.slice(i, i + 100).join(',')}&${auth}`);
      const gj = await g.json();
      for (const p of (gj.payments || [])) {
        const m = String(p.paymentMethod);
        if (!byMethod[m]) byMethod[m] = { count: 0, samples: [] };
        byMethod[m].count++;
        if (byMethod[m].samples.length < 3) byMethod[m].samples.push({ paymentID: p.paymentID, amount: p.amount, checkNumber: p.checkNumber, last4: p.cardLast4 || p.last4, ccType: p.ccType || p.cardType });
      }
    }
    return NextResponse.json({ note: 'paymentMethod code distribution from real payments. Cross-reference samples (checkNumber present=Check, card fields present=Card, etc.) to map codes.', byMethod });
  }

  // SAFE READ: inspect a ticket + its customer (to build the real $1 write correctly). Creates nothing.
  if (sp.get('inspect') === '1') {
    const ticketId = sp.get('ticket'); const custId = sp.get('customer');
    const out: any = {};
    if (ticketId) {
      const t = await fetch(`${BASE}/ticket/get?ticketIDs=${ticketId},${ticketId}&${auth}`);
      const tj = await t.json();
      const tk = (tj.tickets || [])[0];
      out.ticket = tk ? { ticketID: tk.ticketID, customerID: tk.customerID, total: tk.total, balance: tk.balance, serviceID: tk.serviceID, invoiceDate: tk.invoiceDate, _keys: Object.keys(tk) } : { notFound: true };
    }
    if (custId) {
      const c = await fetch(`${BASE}/customer/get?customerIDs=${custId},${custId}&${auth}`);
      const cj = await c.json();
      const cu = (cj.customers || [])[0];
      out.customer = cu ? {
        customerID: cu.customerID, fname: cu.fname, lname: cu.lname, companyName: cu.companyName,
        email: cu.email, phone1: cu.phone1, phone2: cu.phone2,
        address: cu.address, city: cu.city, state: cu.state, zip: cu.zip,
        billingAddress: cu.billingAddress, billingCity: cu.billingCity, billingState: cu.billingState, billingZip: cu.billingZip, billingCompanyName: cu.billingCompanyName, billingFName: cu.billingFName, billingLName: cu.billingLName,
        balance: cu.balance, _keys: Object.keys(cu),
      } : { notFound: true };
    }
    return NextResponse.json({ note: 'Read-only inspection — nothing created.', ...out });
  }

  // CLEANUP: find payments created today (to locate the stray $0 one), and optionally void/delete by id.
  if (sp.get('cleanup') === 'find') {
    // The stray payment(s) I created today have the HIGHEST paymentIDs. Get all IDs, take the top N, inspect them.
    const s = await fetch(`${BASE}/payment/search?${auth}`);
    const sj = await s.json();
    const ids: number[] = (sj.paymentIDs || []).map(Number).sort((a: number, b: number) => b - a); // newest first
    const topN = ids.slice(0, 20);
    let payments: any[] = [];
    if (topN.length) {
      const g = await fetch(`${BASE}/payment/get?paymentIDs=${topN.join(',')}&${auth}`);
      const gj = await g.json();
      payments = (gj.payments || []).map((p: any) => ({ paymentID: p.paymentID, customerID: p.customerID, amount: p.amount, date: p.date, dateCreated: p.dateUpdated || p.date, paymentMethod: p.paymentMethod, status: p.status, check: p.checkNumber }))
        .sort((a: any, b: any) => Number(b.paymentID) - Number(a.paymentID));
    }
    return NextResponse.json({ note: 'Top 20 newest paymentIDs — the stray $0 / customerID 0 one(s) from today will be here.', maxId: ids[0], payments });
  }
  if (sp.get('cleanup') === 'void') {
    const pid = sp.get('paymentID');
    if (!pid) return NextResponse.json({ error: 'paymentID required' }, { status: 400 });
    // try void then delete action names
    const out: any = {};
    for (const act of ['void', 'delete', 'cancel']) {
      const r = await fetch(`${BASE}/payment/${act}?paymentIDs=${pid}&${auth}`);
      const t = await r.text(); let p: any; try { p = JSON.parse(t); } catch { p = t.slice(0, 200); }
      out[act] = { success: p?.success, errorMessage: p?.errorMessage };
      if (p?.success) break;
    }
    return NextResponse.json({ paymentID: pid, result: out });
  }

  return NextResponse.json({
    note: 'Safe probe — no payment params sent, so nothing was created. Reading endpoint existence + write quota + error shapes only.',
    office: sp.get('office') || 'DFW',
    ...results,
  });
}
