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

  // 1) all flag assignments for this customer (entityIDs plural)
  const s = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityIDs=${custId}&type=CUST`).then(r => r.json()).catch(() => null);
  const ids = (s?.genericFlagAssignmentIDs || []).slice(0, 50);
  let flags: any[] = [];
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=${ids.join(',')}`).then(r => r.json()).catch(() => null);
    flags = (g?.genericFlagAssignments || []).map((a: any) => ({ assignmentID: a.genericFlagAssignmentID, genericFlagID: a.genericFlagID, entityID: a.entityID, type: a.type, status: a.status }));
  }
  // 2) look at assignment 125136 directly (the one 'create' claimed to make)
  const direct = await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=125136,125136`).then(r => r.json()).catch(() => null);

  return NextResponse.json({
    custId,
    assignmentIDsForCustomer: ids,
    resolvedFlags: flags,
    assignment125136: direct?.genericFlagAssignments?.[0] || direct,
  });
}
