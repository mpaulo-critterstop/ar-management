import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = req.nextUrl.searchParams.get('custId') || '11440';
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  const s = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityID=${custId}&type=CUST&genericFlagID=69`).then(r => r.json()).catch(() => null);
  return NextResponse.json({ custId, hasNoReviewFlag: (s?.genericFlagAssignmentIDs || []).length > 0, assignmentIDs: s?.genericFlagAssignmentIDs });
}
