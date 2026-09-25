// Probe: scan insulation-group route appointments over a window, pull their customers' invoices, and
// aggregate ALL distinct line-item productIDs + descriptions with totals — to find every insulation-related
// product (FAR, Insulation Removal only, Insulation Top-off only, etc.) beyond productID 10.
//   /api/cron/fr-insulation-products?token=critterstop2026&office=DFW&days=60
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

let chain: Promise<any> = Promise.resolve();
function fr(url: string): Promise<any> {
  const run = chain.then(async () => { await new Promise(r => setTimeout(r, 1100)); const r = await fetch(url); return r.json(); });
  chain = run.catch(() => {});
  return run;
}
const fmt = (d: Date) => d.toISOString().split('T')[0];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const cfg = OFFICES[office];
  if (!cfg?.key) return NextResponse.json({ error: 'bad office' }, { status: 400 });
  const days = parseInt(sp.get('days') || '60');
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  const start = fmt(new Date(Date.now() - days * 86400000));
  const end = fmt(new Date());

  // 1) Insulation-group routes in the window.
  const routeSearch = await fr(`${BASE_URL}/route/search?officeIDs=${cfg.officeId}&dateStart=${start}&dateEnd=${end}&${auth}`);
  const routeIds: string[] = (routeSearch.routeIDs || []).map(String);
  // fetch routes (batches of 100) and keep insulation group
  const insulationRouteIds: string[] = [];
  for (let i = 0; i < routeIds.length; i += 100) {
    const batch = routeIds.slice(i, i + 100).join(',');
    const rg = await fr(`${BASE_URL}/route/get?routeIDs=${batch}&${auth}`);
    for (const r of (rg.routes || [])) {
      if (String(r.groupTitle || '').toLowerCase().includes('insulation')) insulationRouteIds.push(String(r.routeID));
    }
  }

  // 2) Appointments on those routes → customers.
  const custIds = new Set<string>();
  for (let i = 0; i < insulationRouteIds.length; i += 40) {
    const batch = insulationRouteIds.slice(i, i + 40).join(',');
    const as = await fr(`${BASE_URL}/appointment/search?routeIDs=${batch}&${auth}`);
    const ids: any[] = (as.appointmentIDs || []).slice(0, 300);
    for (let j = 0; j < ids.length; j += 100) {
      const ag = await fr(`${BASE_URL}/appointment/get?appointmentIDs=${ids.slice(j, j + 100).join(',')}&${auth}`);
      for (const a of (ag.appointments || [])) if (a.customerID) custIds.add(String(a.customerID));
    }
  }

  // 3) Those customers' tickets → aggregate distinct productID + description with totals.
  const products = new Map<string, { productID: string; description: string; count: number; totalAmount: number; sampleAmounts: number[] }>();
  const custArr: string[] = [...custIds].slice(0, 120); // cap for the probe
  for (let i = 0; i < custArr.length; i += 1) {
    const ts = await fr(`${BASE_URL}/ticket/search?customerID=${custArr[i]}&${auth}`);
    const tIds: any[] = (ts.ticketIDs || []).slice(0, 20);
    if (!tIds.length) continue;
    const tg = await fr(`${BASE_URL}/ticket/get?ticketIDs=${tIds.join(',')}&${auth}`);
    for (const t of (tg.tickets || [])) {
      for (const it of (t.items || [])) {
        const key = `${it.productID}|${(it.description || '').trim()}`;
        const amt = parseFloat(it.amount || '0');
        const cur = products.get(key) || { productID: String(it.productID), description: (it.description || '').trim(), count: 0, totalAmount: 0, sampleAmounts: [] as number[] };
        cur.count++; cur.totalAmount += amt;
        if (cur.sampleAmounts.length < 3 && amt > 0) cur.sampleAmounts.push(amt);
        products.set(key, cur);
      }
    }
  }

  const list = [...products.values()].sort((a, b) => b.totalAmount - a.totalAmount);
  return NextResponse.json({ office, days, insulationRoutes: insulationRouteIds.length, customersScanned: custArr.length, distinctProducts: list.length, products: list });
}
