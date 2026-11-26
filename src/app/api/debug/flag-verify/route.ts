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

  // create flag 69 + capture exact response
  const cr = await fetch(`${FR_BASE}/genericFlagAssignment/create?${auth}&genericFlagID=69&entityID=${custId}&type=CUST`, { method: 'POST' }).then(r => r.json()).catch(() => null);
  const newId = cr?.result;
  // immediately get it back by ID
  const back = newId ? await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=${newId},${newId}`).then(r => r.json()).catch(() => null) : null;
  // and re-search all for the customer
  const s = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityIDs=${custId}&type=CUST`).then(r => r.json()).catch(() => null);
  const ids = (s?.genericFlagAssignmentIDs || []).slice(0, 50);
  let flags: any[] = [];
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=${ids.join(',')}`).then(r => r.json()).catch(() => null);
    flags = (g?.genericFlagAssignments || []).map((a: any) => ({ assignmentID: a.genericFlagAssignmentID, genericFlagID: a.genericFlagID }));
  }
  return NextResponse.json({
    custId,
    createResponse: { success: cr?.success, result: cr?.result, error: cr?.errorMessage, ignoredParams: cr?.ignoredParams },
    getByNewId: { count: back?.count, found: back?.genericFlagAssignments?.[0] || null },
    allFlagsNow: flags,
  });
}
