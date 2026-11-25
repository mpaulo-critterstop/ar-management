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

  // 1) search notes for this customer (to see if note/search filters by customer)
  const ns = await fetch(`${FR_BASE}/note/search?${auth}&customerID=${custId}`).then(r => r.json()).catch(() => null);
  out.noteSearch = { success: ns?.success, count: ns?.count, idName: ns?.idName, ignoredParams: ns?.ignoredParams, noteIDs: (ns?.noteIDs || []).slice(0, 5) };

  // 2) get an existing note's full structure
  const nids = ns?.noteIDs || [];
  if (nids.length) {
    const g = await fetch(`${FR_BASE}/note/get?${auth}&noteIDs=${nids.slice(0,2).join(',')}`).then(r => r.json()).catch(() => null);
    out.noteSample = (g?.notes || []).map((n: any) => ({ noteID: n.noteID, entityID: n.entityID, type: n.type, note: n.note, showCustomer: n.showCustomer, showTech: n.showTech, dateAdded: n.dateAdded, addedBy: n.addedBy }));
  }

  // 3) also check the customer's own 'notes' field (the plain Notes box on the account)
  const cg = await fetch(`${FR_BASE}/customer/get?${auth}&customerIDs=${custId},${custId}`).then(r => r.json()).catch(() => null);
  out.customerNotesField = cg?.customers?.[0]?.notes;

  return NextResponse.json(out);
}
