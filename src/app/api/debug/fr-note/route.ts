import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = sp.get('custId') || '52568'; // David Macdonald — a real customer likely with notes
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  const out: any = { custId };
  // try filtering notes by entityID + type=customer (FR note entity model)
  for (const filter of [`entityID=${custId}`, `entityID=${custId}&type=customer`, `entityID=${custId}&type=CUST`]) {
    const ns = await fetch(`${FR_BASE}/note/search?${auth}&${filter}`).then(r => r.json()).catch(() => null);
    out[filter] = { count: ns?.count, ignored: ns?.ignoredParams, ids: (ns?.noteIDs || []).slice(0, 3) };
  }
  // get a real note with text — pull a few recent high note IDs
  const recent = await fetch(`${FR_BASE}/note/search?${auth}&entityID=${custId}&type=customer`).then(r => r.json()).catch(() => null);
  const ids = recent?.noteIDs || [];
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/note/get?${auth}&noteIDs=${ids.slice(0,3).join(',')}`).then(r => r.json()).catch(() => null);
    out.notesForCustomer = (g?.notes || []).map((n: any) => ({ noteID: n.noteID, entityID: n.entityID, type: n.type, note: n.note, showCustomer: n.showCustomer, showTech: n.showTech, addedBy: n.addedBy, dateAdded: n.dateAdded }));
  }
  return NextResponse.json(out);
}
