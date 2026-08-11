// READ-ONLY debug: inspect FieldRoutes subscription data for a customer.
//   /api/debug/fr-subscription?customerId=20208&office=CStat&token=critterstop2026
// Returns the raw FR subscription object(s) so we can see recurring price + related fields.
import { NextRequest, NextResponse } from 'next/server';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

async function frGet(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url);
  return res.json();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const customerId = sp.get('customerId');
  const office = sp.get('office') || 'CStat';
  if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 });
  const cfg = OFFICES[office];
  if (!cfg?.key) return NextResponse.json({ error: `Unknown/unconfigured office: ${office}` }, { status: 400 });

  // 1) find the customer's subscription IDs
  const search = await frGet('subscription/search', `customerIDs=${customerId}`, cfg.key, cfg.token);
  const ids: any[] = search?.subscriptionIDs || search?.data || [];

  // 2) fetch full subscription objects — try a few param variations, since a bare
  //    subscription/get?subscriptionIDs= can come back empty for some subs.
  let subs: any = null;
  let subsVariantUsed = '';
  if (ids.length) {
    const idStr = ids.join(',');
    const variants: Array<[string, string]> = [
      ['plain', `subscriptionIDs=${idStr}`],
      ['withOffice', `subscriptionIDs=${idStr}&officeIDs=4`],
      ['includeInactive', `subscriptionIDs=${idStr}&includeData=1&active=0`],
      ['activeAll', `subscriptionIDs=${idStr}&active=-1`],
    ];
    for (const [label, params] of variants) {
      const r = await frGet('subscription/get', params, cfg.key, cfg.token);
      if (r?.count > 0 && (r?.subscriptions?.length || 0) > 0) { subs = r; subsVariantUsed = label; break; }
      subs = r; subsVariantUsed = label + ' (empty)';
    }
  }

  // Also pull the customer object for context (name, master account, etc.)
  const cust = await frGet('customer/get', `customerIDs=${customerId}`, cfg.key, cfg.token);

  return NextResponse.json({
    office,
    customerId,
    subscriptionSearchRaw: search,
    subscriptionIDs: ids,
    subsVariantUsed,
    subscriptions: subs,
    customer: cust,
  });
}
