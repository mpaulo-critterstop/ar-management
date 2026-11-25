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

  // find valid contactType values from an existing real note (get a note that has contactType populated)
  if (sp.get('inspect') === '1') {
    const g = await fetch(`${FR_BASE}/note/get?${auth}&noteIDs=49000,49500,49900`).then(r => r.json()).catch(() => null);
    return NextResponse.json({ sampleNotes: (g?.notes || []).map((n: any) => ({ noteID: n.noteID, customerID: n.customerID, entityID: n.entityID, type: n.type, contactType: n.contactType, note: n.note, date: n.date, showCustomer: n.showCustomer })) });
  }

  if (sp.get('confirm') !== '1') return NextResponse.json({ note: 'add &inspect=1 to see a real note structure, or &confirm=1&ct=N to test create' });
  const ct = sp.get('ct') || '1';
  const today = new Date().toISOString().slice(0, 10);
  const text = encodeURIComponent('Hub test note — please ignore');
  const qs = `customerID=${custId}&type=customer&note=${text}&date=${today}&contactType=${ct}&showCustomer=0&showTech=0`;
  const r = await fetch(`${FR_BASE}/note/create?${auth}&${qs}`, { method: 'POST' });
  const j = await r.json().catch(() => null);
  const newId = j?.result || null;
  let created = null;
  if (newId) { const g = await fetch(`${FR_BASE}/note/get?${auth}&noteIDs=${newId},${newId}`).then(r => r.json()).catch(() => null); created = g?.notes?.[0]; }
  return NextResponse.json({ custId, contactTypeTried: ct, createSuccess: j?.success, error: j?.errorMessage, newNoteId: newId, createdNote: created });
}
