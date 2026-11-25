import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
// Test adding the "No Review" flag (genericFlagID 69) to a customer via genericFlagAssignment/create.
// ?token= &custId=11440 &confirm=1
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = sp.get('custId') || '11440';
  const NO_REVIEW_FLAG = '69';
  // find which office this customer belongs to
  let auth = '', foundOffice = '';
  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!(cfg as any).key) continue;
    const a = `authenticationKey=${(cfg as any).key}&authenticationToken=${(cfg as any).token}`;
    const cg = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&${a}`).then(r=>r.json()).catch(()=>null);
    if (cg?.customers?.length) { auth = a; foundOffice = office; break; }
  }
  if (!auth) return NextResponse.json({ error: 'customer not found in any office', custId });

  // does the customer already have flag 69?
  const existing = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityID=${custId}&type=customer&genericFlagID=${NO_REVIEW_FLAG}`).then(r => r.json()).catch(() => null);
  const already = (existing?.genericFlagAssignmentIDs || []).length > 0;

  if (sp.get('confirm') !== '1') {
    return NextResponse.json({ custId, office: foundOffice, flag: 'No Review (genericFlagID 69)', alreadyHasFlag: already, note: 'add &confirm=1 to assign it' });
  }
  if (already) return NextResponse.json({ custId, status: 'already has No Review flag', existing: existing.genericFlagAssignmentIDs });

  // create the assignment. FR genericFlagAssignment/create params: genericFlagID, entityID (customerID), type=customer
  const qs = `genericFlagID=${NO_REVIEW_FLAG}&entityID=${custId}&type=customer`;
  const r = await fetch(`${FR_BASE}/genericFlagAssignment/create?${auth}&${qs}`, { method: 'POST' });
  const j = await r.json().catch(() => null);
  // verify
  const after = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityID=${custId}&type=customer&genericFlagID=${NO_REVIEW_FLAG}`).then(r => r.json()).catch(() => null);
  return NextResponse.json({ custId, office: foundOffice, createResponse: { success: j?.success, error: j?.errorMessage, raw: j?.success === undefined ? j : undefined }, nowHasFlag: (after?.genericFlagAssignmentIDs || []).length > 0, assignmentIDs: after?.genericFlagAssignmentIDs });
}
