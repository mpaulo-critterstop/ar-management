import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  // list the available flag TYPES (the definitions) to find "No Review"
  const ftSearch = await fetch(`${FR_BASE}/flagType/search?${auth}&includeData=1`).then(r => r.json()).catch(() => null);
  let flagTypes: any[] = [];
  const ftIds = ftSearch?.flagTypeIDs || [];
  if (ftIds.length) {
    const g = await fetch(`${FR_BASE}/flagType/get?${auth}&flagTypeIDs=${ftIds.slice(0,200).join(',')}`).then(r => r.json()).catch(() => null);
    flagTypes = (g?.flagTypes || []).map((f: any) => ({ id: f.flagTypeID, code: f.code, description: f.description }));
  }
  // find review-related flags
  const reviewFlags = flagTypes.filter((f: any) => /review|no.?review|happy|complain|unhappy/i.test(`${f.code} ${f.description}`));
  return NextResponse.json({ totalFlagTypes: flagTypes.length, reviewRelatedFlags: reviewFlags, allFlagTypes: flagTypes.slice(0, 80) });
}
