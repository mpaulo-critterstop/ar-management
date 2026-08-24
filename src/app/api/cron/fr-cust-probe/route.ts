// READ-ONLY probe: given a customerID, show what FR returns for the customer AND their subscriptions —
// to trace records that appear in the Hub job pool but can't be found in FR (deleted/inactive/status).
//   /api/cron/fr-cust-probe?token=critterstop2026&office=DFW&cust=10248
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};
async function frGet(ep: string, params: string, key: string, token: string) {
  const r = await fetch(`${FR_BASE}/${ep}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return r.json();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const cust = sp.get('cust');
  const sub = sp.get('sub');
  const cfg = OFFICES[office];
  if (!cfg?.key || !cust) return NextResponse.json({ error: 'need office + cust' }, { status: 400 });

  const out: any = { office, cust };

  // Customer record
  const cr = await frGet('customer/get', `customerIDs=${cust},${cust}`, cfg.key, cfg.token);
  const c = (cr?.customers || [])[0];
  out.customerFound = !!c;
  if (c) out.customer = {
    customerID: c.customerID, fname: c.fname, lname: c.lname, companyName: c.companyName,
    status: c.status, statusText: c.statusText, active: c.active, // status flags
    dateAdded: c.dateAdded, dateCancelled: c.dateCancelled, dateUpdated: c.dateUpdated,
    phone1: c.phone1, email: c.email,
  };
  else out.customerRaw = cr; // show the raw response if not found (may reveal an error/empty)
  if (c) out.customerFullRaw = c; // entire raw customer object — to see every status-related field

  // Replicate the pest-inspections sync's subscription lookup for this customer.
  const subSearch = await frGet('subscription/search', `customerIDs=${cust}`, cfg.key, cfg.token);
  out.subSearch = { success: subSearch?.success, count: (subSearch?.subscriptionIDs || []).length, ids: subSearch?.subscriptionIDs || [], error: subSearch?.errorMessage || null };
  const sids: number[] = subSearch?.subscriptionIDs || [];
  if (sids.length) {
    const sr = await frGet('subscription/get', `subscriptionIDs=${sids.slice(0, 50).join(',')}`, cfg.key, cfg.token);
    out.subscriptions = (sr?.subscriptions || []).map((s: any) => ({
      subscriptionID: s.subscriptionID, serviceID: s.serviceID, active: s.active, activeText: s.activeText,
      contractValue: s.contractValue, recurringCharge: s.recurringCharge, dateCancelled: s.dateCancelled,
    }));
  }

  // The specific subscription (if provided)
  if (sub) {
    const sr = await frGet('subscription/get', `subscriptionIDs=${sub},${sub}`, cfg.key, cfg.token);
    const s = (sr?.subscriptions || [])[0];
    out.subscriptionFound = !!s;
    if (s) out.subscription = {
      subscriptionID: s.subscriptionID, customerID: s.customerID, active: s.active, activeText: s.activeText,
      dateCancelled: s.dateCancelled, onHold: s.onHold, frequency: s.frequency, lastCompleted: s.lastCompleted,
      nextService: s.nextService, serviceType: s.serviceType, dateUpdated: s.dateUpdated,
    };
    else out.subscriptionRaw = sr;
  }

  return NextResponse.json(out);
}
