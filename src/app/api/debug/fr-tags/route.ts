import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = req.nextUrl.searchParams.get('custId') || '11440';
  const out: any = { custId, offices: {} };
  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!(cfg as any).key) continue;
    const auth = `authenticationKey=${(cfg as any).key}&authenticationToken=${(cfg as any).token}`;
    const g = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&${auth}`).then(r => r.json()).catch(() => null);
    const c = g?.customers?.[0];
    if (!c) continue;
    // show tag-related fields + all keys (to find where tags live)
    out.offices[office] = {
      name: `${c.fname} ${c.lname}`,
      tagFields: { customerTags: c.customerTags, tags: c.tags, customerFlag: c.customerFlag, flags: c.flags, specialScheduling: c.specialScheduling },
      allKeys: Object.keys(c),
    };
    out.foundIn = office;
  }
  // also list available customer tags/flags in the system (tagType/flag endpoints)
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  const tagSearch = await fetch(`${FR_BASE}/customerFlag/search?${auth}`).then(r => r.json()).catch(() => null);
  out.customerFlagSearch = tagSearch?.customerFlagIDs ? { count: tagSearch.count, ids: (tagSearch.customerFlagIDs||[]).slice(0,10) } : tagSearch;
  return NextResponse.json(out);
}
