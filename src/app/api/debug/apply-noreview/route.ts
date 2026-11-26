import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = sp.get('custId') || '49690';
  const cfg = (FR_OFFICES as any).DFW;
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  const out: any = { custId };

  // try correct filter param names for genericFlagAssignment/search
  const tries: Record<string,string> = {
    entityIDs_type: `entityIDs=${custId}&type=CUST`,
    customerIDs: `customerIDs=${custId}`,
    entityID_only: `entityID=${custId}`,
  };
  for (const [name, q] of Object.entries(tries)) {
    const r = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&${q}`).then(r => r.json()).catch(() => null);
    out[name] = { count: r?.count, ignored: r?.ignoredParams, sampleIDs: (r?.genericFlagAssignmentIDs || []).slice(0, 5) };
  }
  // the one that's NOT ignored + low count is the right one; resolve its assignments
  const best = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityIDs=${custId}&type=CUST`).then(r => r.json()).catch(() => null);
  const ids = (best?.genericFlagAssignmentIDs || []).slice(0, 50);
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=${ids.join(',')}`).then(r => r.json()).catch(() => null);
    out.resolvedFlags = (g?.genericFlagAssignments || []).map((a: any) => ({ genericFlagID: a.genericFlagID, entityID: a.entityID, type: a.type }));
  }
  return NextResponse.json(out);
}
