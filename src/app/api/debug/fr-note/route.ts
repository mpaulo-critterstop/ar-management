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

  // find a valid contactType/typeID from recent real notes (type "Notes" is the plain customer note)
  if (sp.get('inspect') === '1') {
    const s = await fetch(`${FR_BASE}/note/search?${auth}&content=${encodeURIComponent('exclusion')}&includeData=1`).then(r => r.json()).catch(() => null);
    const notes = (s?.notes || []).slice(0, 8).map((n: any) => ({ noteID: n.noteID, typeID: n.typeID, type: n.type, notes: (n.notes || '').slice(0, 40) }));
    return NextResponse.json({ sampleTypedNotes: notes });
  }

  if (sp.get('confirm') !== '1') return NextResponse.json({ note: 'add &inspect=1 for typeIDs, or &confirm=1&ct=N to create' });
  const ct = sp.get('ct') || '1';
  const today = new Date().toISOString().slice(0, 10);
  const qs = `customerID=${custId}&date=${today}&contactType=${ct}&notes=${encodeURIComponent('Hub test note — please ignore')}&showOnInvoice=0&showTech=0&showCustomer=0`;
  const r = await fetch(`${FR_BASE}/note/create?${auth}&${qs}`, { method: 'POST' });
  const j = await r.json().catch(() => null);
  const newId = j?.result || null;
  let created = null;
  if (newId) { const g = await fetch(`${FR_BASE}/note/get?${auth}&noteIDs=${newId},${newId}`).then(r => r.json()).catch(() => null); created = g?.notes?.[0]; }
  return NextResponse.json({ custId, contactTypeTried: ct, createSuccess: j?.success, error: j?.errorMessage, newNoteId: newId, createdNote: created ? { noteID: created.noteID, customerID: created.customerID, type: created.type, notes: created.notes, date: created.date } : null });
}
