import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  const out: any = {};
  // try different endpoints for flag definitions
  for (const ep of ['flag', 'customerFlag', 'genericFlag', 'flagType']) {
    const s = await fetch(`${FR_BASE}/${ep}/search?${auth}`).then(r => r.json()).catch(() => null);
    out[ep] = { success: s?.success, count: s?.count, idName: s?.idName, keys: s ? Object.keys(s).filter(k => k.toLowerCase().includes('id')) : null };
  }
  // customerFlag/get on one customer that HAS flags (e.g. custId 11440) to see the flag structure
  const cf = await fetch(`${FR_BASE}/customerFlag/search?${auth}&customerIDs=11440`).then(r => r.json()).catch(() => null);
  out.customer11440Flags = { count: cf?.count, ids: cf?.customerFlagIDs || cf?.genericFlagAssignmentIDs };
  // get the flag assignment detail
  const assignIds = cf?.customerFlagIDs || cf?.genericFlagAssignmentIDs || [];
  if (assignIds.length) {
    const g = await fetch(`${FR_BASE}/customerFlag/get?${auth}&customerFlagIDs=${assignIds.slice(0,5).join(',')}`).then(r => r.json()).catch(() => null);
    out.flagAssignmentSample = g?.customerFlags || g;
  }
  return NextResponse.json(out);
}
