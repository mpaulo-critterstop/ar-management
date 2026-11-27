import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = req.nextUrl.searchParams.get('custId') || '11440';
  const dfw = (FR_OFFICES as any).DFW;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  const g = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&${auth}`).then(r => r.json()).catch(() => null);
  const c = g?.customers?.[0] || {};
  // show ALL email-related fields
  return NextResponse.json({
    custId,
    name: `${c.fname} ${c.lname}`,
    email: c.email,
    billingEmail: c.billingEmail,
    emailFields: Object.keys(c).filter(k => k.toLowerCase().includes('email')),
    emailValues: Object.fromEntries(Object.keys(c).filter(k => k.toLowerCase().includes('email')).map(k => [k, c[k]])),
    phone1: c.phone1, phone2: c.phone2,
  });
}
