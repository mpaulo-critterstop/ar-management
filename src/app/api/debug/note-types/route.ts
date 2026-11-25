import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dfw = FR_OFFICES.DFW as any;
  const auth = `authenticationKey=${dfw.key}&authenticationToken=${dfw.token}`;
  // sample many recent notes + collect distinct typeID -> type label mappings
  const s = await fetch(`${FR_BASE}/note/search?${auth}&noteIDs=${JSON.stringify({operator:'>',value:880000})}&includeData=1`).then(r => r.json()).catch(() => null);
  const notes = s?.notes || [];
  const typeMap: Record<string, string> = {};
  for (const n of notes) { if (n.typeID) typeMap[n.typeID] = n.type; }
  // delete the test note 884177 if requested
  if (sp.get('delTest') === '1') {
    const d = await fetch(`${FR_BASE}/note/delete?${auth}&customerID=11440&contactID=884177`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    return NextResponse.json({ deletedTestNote: d?.success ?? d, typeMap });
  }
  return NextResponse.json({ distinctNoteTypes: typeMap, sampleCount: notes.length });
}
