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

  // 1) ALL flag assignments for this customer (what flags does she ACTUALLY have?)
  const all = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityID=${custId}&type=CUST`).then(r => r.json()).catch(() => null);
  const ids = all?.genericFlagAssignmentIDs || [];
  let assignments: any[] = [];
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=${ids.join(',')}`).then(r => r.json()).catch(() => null);
    assignments = (g?.genericFlagAssignments || []).map((a: any) => ({ assignmentID: a.genericFlagAssignmentID, genericFlagID: a.genericFlagID, entityID: a.entityID, type: a.type }));
  }

  // 2) my earlier (possibly buggy) query — filter by genericFlagID=69, see what it returns + whether the filter is ignored
  const q69 = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityID=${custId}&type=CUST&genericFlagID=69`).then(r => r.json()).catch(() => null);

  return NextResponse.json({
    custId,
    allFlagAssignments: assignments,
    genericFlagIDsOnCustomer: assignments.map(a => a.genericFlagID),
    query69_returnedIDs: q69?.genericFlagAssignmentIDs,
    query69_ignoredParams: q69?.ignoredParams,
    query69_count: q69?.count,
  });
}
