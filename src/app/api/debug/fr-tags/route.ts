import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = sp.get('custId') || '11440';
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  const out: any = { custId };

  // 1) confirm customer read + its officeID
  const cg = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&${auth}`).then(r => r.json()).catch(() => null);
  out.customerOfficeID = cg?.customers?.[0]?.officeID;

  // 2) look at an EXISTING genericFlagAssignment to see the correct param names
  const anyAssign = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&genericFlagID=69`).then(r => r.json()).catch(() => null);
  const aid = (anyAssign?.genericFlagAssignmentIDs || [])[0];
  if (aid) {
    const g = await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=${aid},${aid}`).then(r => r.json()).catch(() => null);
    out.existingAssignmentSample = g?.genericFlagAssignments?.[0];
  }

  // 3) try create variations if confirm
  if (sp.get('confirm') === '1') {
    const variations: any = {};
    // variation A: entityID + type=CUST (uppercase, matching flag type)
    let r = await fetch(`${FR_BASE}/genericFlagAssignment/create?${auth}&genericFlagID=69&entityID=${custId}&type=CUST`, { method: 'POST' });
    variations.A_typeCUST = await r.json().catch(() => null);
    return NextResponse.json({ ...out, createAttempts: variations });
  }
  return NextResponse.json({ ...out, note: 'add &confirm=1 to try create with type=CUST' });
}
