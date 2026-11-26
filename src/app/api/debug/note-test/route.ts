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
  const today = new Date().toISOString().slice(0, 10);
  // contactType=0 = general "Notes"
  const qs = `customerID=${custId}&date=${today}&contactType=0&notes=${encodeURIComponent('Hub test note (general Notes) — please ignore')}&showOnInvoice=0&showTech=0&showCustomer=0`;
  const r = await fetch(`${FR_BASE}/note/create?${auth}&${qs}`, { method: 'POST' });
  const j = await r.json().catch(() => null);
  const newId = j?.result || null;
  let created = null;
  if (newId) { const g = await fetch(`${FR_BASE}/note/get?${auth}&noteIDs=${newId},${newId}`).then(r => r.json()).catch(() => null); created = g?.notes?.[0]; }
  return NextResponse.json({ custId, createSuccess: j?.success, error: j?.errorMessage, newNoteId: newId, createdNote: created ? { noteID: created.noteID, customerID: created.customerID, typeID: created.typeID, type: created.type, notes: created.notes, date: created.date } : null });
}
