import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  // get all generic flag definitions
  const s = await fetch(`${FR_BASE}/genericFlag/search?${auth}`).then(r => r.json()).catch(() => null);
  const ids = s?.genericFlagIDs || [];
  let flags: any[] = [];
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/genericFlag/get?${auth}&genericFlagIDs=${ids.join(',')}`).then(r => r.json()).catch(() => null);
    flags = (g?.genericFlags || []).map((f: any) => ({ id: f.genericFlagID, code: f.code, description: f.description, type: f.type, status: f.status }));
  }
  const reviewFlags = flags.filter((f: any) => /review|happy|complain|unhappy|do.?not/i.test(`${f.code} ${f.description}`));
  return NextResponse.json({ totalFlags: flags.length, reviewRelatedFlags: reviewFlags, allFlags: flags });
}
