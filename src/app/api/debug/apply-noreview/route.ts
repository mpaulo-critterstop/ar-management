import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const NO_REVIEW_FLAG = '69';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = sp.get('custId') || '49690';
  const office = sp.get('office') || 'DFW';
  const cfg = (FR_OFFICES as any)[office];
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

  // confirm customer + current flag state
  const cg = await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&${auth}`).then(r => r.json()).catch(() => null);
  const c = cg?.customers?.[0];
  const existing = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityID=${custId}&type=CUST&genericFlagID=${NO_REVIEW_FLAG}`).then(r => r.json()).catch(() => null);
  const alreadyFlagged = (existing?.genericFlagAssignmentIDs || []).length > 0;

  if (sp.get('confirm') !== '1') {
    return NextResponse.json({ custId, customer: c ? `${c.fname} ${c.lname}` : 'NOT FOUND', office: c?.officeID, alreadyHasNoReviewFlag: alreadyFlagged, note: 'add &confirm=1 to add flag + note' });
  }
  const out: any = { custId, customer: c ? `${c.fname} ${c.lname}` : null };
  if (alreadyFlagged) { out.flag = 'already had No Review flag'; }
  else {
    const fr = await fetch(`${FR_BASE}/genericFlagAssignment/create?${auth}&genericFlagID=${NO_REVIEW_FLAG}&entityID=${custId}&type=CUST`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    out.flag = fr?.success ? 'added' : 'FAILED';
    out.flagResult = fr?.result;
  }
  // write the note (only if we just added the flag, or force with &note=1)
  if (out.flag === 'added' || sp.get('note') === '1') {
    const today = new Date().toISOString().slice(0, 10);
    const qs = `customerID=${custId}&date=${today}&contactType=0&notes=${encodeURIComponent('Added No Review flag with reason: 4TCs already and not yet closed out')}&showOnInvoice=0&showTech=0&showCustomer=0`;
    const nr = await fetch(`${FR_BASE}/note/create?${auth}&${qs}`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    out.note = nr?.success ? `added (noteID ${nr.result})` : 'FAILED';
  }
  return NextResponse.json(out);
}
