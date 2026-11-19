import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const targets: Record<string, string> = { '52360': 'DFW', '52361': 'DFW', '53075': 'ATX', '53080': 'OKC' };
  const out: any = {};
  for (const [cust, office] of Object.entries(targets)) {
    const c = (FR_OFFICES as any)[office];
    const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
    const as = await fetch(`${FR_BASE}/appointment/search?${auth}&customerIDs=${cust}`).then(r => r.json()).catch(() => null);
    const aids = as?.appointmentIDs || [];
    const g = await fetch(`${FR_BASE}/appointment/get?${auth}&appointmentIDs=${aids.join(',')}${aids.length===1?','+aids[0]:''}`).then(r => r.json()).catch(() => null);
    const excl = (g?.appointments || []).filter((a: any) => String(a.type) === '553');
    out[cust] = excl.map((a: any) => ({ id: a.appointmentID, type: a.type, status: a.status, statusText: a.statusText, dateCompleted: a.dateCompleted, dateCancelled: a.dateCancelled, duration: a.duration, servicedBy: a.servicedBy, subscriptionID: a.subscriptionID }));
  }
  return NextResponse.json(out);
}
