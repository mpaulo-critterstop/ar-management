import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const NO_REVIEW_FLAG = '69';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const custId = sp.get('custId') || '49690';
  const cfg = (FR_OFFICES as any).DFW;
  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

  // correct check: entityIDs plural + client-side flag-69 check
  const existing = await fetch(`${FR_BASE}/genericFlagAssignment/search?${auth}&entityIDs=${custId}&type=CUST`).then(r => r.json()).catch(() => null);
  const exIds = (existing?.genericFlagAssignmentIDs || []).slice(0, 50);
  let hasFlag = false;
  if (exIds.length) {
    const g = await fetch(`${FR_BASE}/genericFlagAssignment/get?${auth}&genericFlagAssignmentIDs=${exIds.join(',')}`).then(r => r.json()).catch(() => null);
    hasFlag = (g?.genericFlagAssignments || []).some((a: any) => String(a.genericFlagID) === NO_REVIEW_FLAG);
  }

  if (sp.get('confirm') !== '1') return NextResponse.json({ custId, alreadyHasNoReview: hasFlag, note: 'add &confirm=1 to apply flag + note' });

  const out: any = { custId };
  if (hasFlag) { out.flag = 'already had No Review'; }
  else {
    const fr = await fetch(`${FR_BASE}/genericFlagAssignment/create?${auth}&genericFlagID=${NO_REVIEW_FLAG}&entityID=${custId}&type=CUST`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    out.flag = fr?.success ? `added (${fr.result})` : 'FAILED';
    if (fr?.success) {
      const today = new Date().toISOString().slice(0, 10);
      const qs = `customerID=${custId}&date=${today}&contactType=0&notes=${encodeURIComponent('Added No Review flag with reason: 4TCs already and not yet closed out')}&showOnInvoice=0&showTech=0&showCustomer=0`;
      const nr = await fetch(`${FR_BASE}/note/create?${auth}&${qs}`, { method: 'POST' }).then(r => r.json()).catch(() => null);
      out.note = nr?.success ? `added (${nr.result})` : 'FAILED';
    }
  }
  return NextResponse.json(out);
}
