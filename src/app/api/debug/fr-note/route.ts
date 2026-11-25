import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
// Test creating a note on a customer to confirm /note/create adds to the Notes section.
// ?token= &custId=11440 &confirm=1
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = sp.get('custId') || '11440';
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;

  if (sp.get('confirm') !== '1') {
    return NextResponse.json({ custId, note: 'add &confirm=1 to create a TEST note "Hub test note — please ignore" on this customer' });
  }
  // note/create params (FR): entityID (customerID), type, note (text), showCustomer, showTech
  const text = encodeURIComponent('Hub test note — please ignore (verifying /note/create)');
  const today = new Date().toISOString().slice(0,10);
  const qs = `customerID=${custId}&type=customer&note=${text}&date=${today}&contactType=0&showCustomer=0&showTech=0`;
  const r = await fetch(`${FR_BASE}/note/create?${auth}&${qs}`, { method: 'POST' });
  const j = await r.json().catch(() => null);
  const newNoteId = j?.result || j?.noteID || null;
  // read it back
  let created = null;
  if (newNoteId) {
    const g = await fetch(`${FR_BASE}/note/get?${auth}&noteIDs=${newNoteId},${newNoteId}`).then(r => r.json()).catch(() => null);
    created = g?.notes?.[0];
  }
  return NextResponse.json({ custId, createSuccess: j?.success, error: j?.errorMessage, newNoteId, createdNote: created, rawCreateResponse: j?.success === undefined ? j : undefined });
}
