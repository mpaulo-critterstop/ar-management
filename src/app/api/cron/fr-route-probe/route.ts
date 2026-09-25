// Probe: dump the COMPLETE FR route object to see every field, incl. any additional/secondary tech fields
// beyond assignedTech. Also dumps a route's spots (appointments) which can carry their own servicedBy.
//   /api/cron/fr-route-probe?token=critterstop2026&office=DFW&date=2026-09-24   (finds routes that day, dumps first few full)
//   /api/cron/fr-route-probe?token=critterstop2026&office=DFW&routeID=12345      (dump one specific route)
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

async function fr(url: string) { const r = await fetch(url); return r.json(); }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const cfg = OFFICES[office];
  if (!cfg?.key) return NextResponse.json({ error: 'bad office' }, { status: 400 });
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

  let routeIDs: string[] = [];
  const explicit = sp.get('routeID');
  if (explicit) {
    routeIDs = [explicit];
  } else {
    const date = sp.get('date') || new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const search = await fr(`${BASE_URL}/route/search?officeIDs=${cfg.officeId}&dateStart=${date}&dateEnd=${date}&${auth}`);
    routeIDs = (search.routeIDs || []).slice(0, 3).map(String); // first 3 routes that day
  }
  if (!routeIDs.length) return NextResponse.json({ office, note: 'no routes found', routeIDs: [] });

  const idParam = routeIDs.length === 1 ? `${routeIDs[0]},${routeIDs[0]}` : routeIDs.join(',');
  const got = await fr(`${BASE_URL}/route/get?routeIDs=${idParam}&${auth}`);
  const routes = (got.routes || []).map((r: any) => ({
    routeID: r.routeID, date: r.date, assignedTech: r.assignedTech,
    _allKeys: Object.keys(r),
    // surface any field that might hold additional techs
    additionalTechs: r.additionalTechs, additionalTech: r.additionalTech, assignedTechs: r.assignedTechs,
    secondaryTech: r.secondaryTech, helpers: r.helpers, techIDs: r.techIDs, employeeIDs: r.employeeIDs,
    _raw: JSON.stringify(r).substring(0, 1500),
  }));

  return NextResponse.json({ office, routeIDsProbed: routeIDs, routes });
}
