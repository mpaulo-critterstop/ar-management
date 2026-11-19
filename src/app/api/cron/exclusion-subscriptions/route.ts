import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { FR_OFFICES } from '@/lib/helcimBridge';
import {
  resolveGuarantee, createAnnualInspection, createTrapCheck, customerHasService, pmNameToFrId,
  ANNUAL_INSPECTION_SERVICE, TRAP_CHECK_SERVICE,
} from '@/lib/annualInspection';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const EXCL_SERVICE = '553';
const STATE_KEY = 'excl_sub_created_state'; // JSON map: `${customerId}` -> { ai: subId|false, trap: subId|false, at }

// Daily: find exclusions (553) completed in the lookback window, and for each, create the Annual Inspection (533)
// subscription (and Trap Check 504 if trapping was in the proposal) — guarantee tier + PM come from the stored
// SmarterLaunch estimate record. Idempotent via state + live FR checks. ?token=critterstop2026 &dry=1 &days=N
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const days = Math.min(parseInt(sp.get('days') || '2', 10) || 2, 30);

  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  // load state + stored estimates
  const stateRow = await prisma.appSetting.findUnique({ where: { key: STATE_KEY } });
  const state: Record<string, any> = stateRow ? JSON.parse(stateRow.value) : {};
  const estRows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
  const estByFr: Record<string, any> = {};
  for (const r of estRows) { try { const rec = JSON.parse(r.value); if (rec.frCustomerId) estByFr[String(rec.frCustomerId)] = rec; } catch {} }

  const actions: any[] = [];
  const seen = new Set<string>();

  for (const [office, c] of Object.entries(FR_OFFICES)) {
    if (!c.key) continue;
    const auth = `authenticationKey=${c.key}&authenticationToken=${c.token}`;
    const asRes = await fetch(`${FR_BASE}/appointment/search?${auth}&officeIDs=${c.officeId}&serviceID=${EXCL_SERVICE}&dateCompleted=${encodeURIComponent(JSON.stringify({ operator: 'BETWEEN', value: [`${from} 00:00:00`, `${to} 23:59:59`] }))}`).then(r => r.json()).catch(() => null);
    const aids = (asRes?.appointmentIDs || []).slice(0, 200);
    if (!aids.length) continue;
    const ag = await fetch(`${FR_BASE}/appointment/get?${auth}&appointmentIDs=${aids.join(',')}${aids.length === 1 ? ',' + aids[0] : ''}`).then(r => r.json()).catch(() => null);
    // FR often ignores the dateCompleted search filter, returning ALL completed exclusions — so filter the
    // window client-side on dateCompleted.
    const fromMs = new Date(`${from}T00:00:00Z`).getTime(), toMs = new Date(`${to}T23:59:59Z`).getTime();
    const appts = (ag?.appointments || []).filter((a: any) => {
      if (!a.dateCompleted || a.dateCompleted === '0000-00-00 00:00:00') return false;
      const t = new Date(String(a.dateCompleted).replace(' ', 'T') + 'Z').getTime();
      return t >= fromMs && t <= toMs;
    });

    for (const a of appts) {
      const customerId = String(a.customerID);
      if (seen.has(customerId)) continue; // one per customer per run
      seen.add(customerId);
      const exclusionDate = a.dateCompleted;
      const est = estByFr[customerId];
      const st = state[customerId] || {};

      // Need the estimate record (has guarantee + PM + trapping). No record -> flag, skip (can't know guarantee).
      if (!est?.estimate) {
        actions.push({ office, customerId, skipped: 'no estimate record (guarantee unknown)' });
        continue;
      }
      const selected: string[] = est.estimate.selectedGroups?.filter((g: string) => /guarantee|warranty|lifetime/i.test(g)) || [];
      const resolved = resolveGuarantee(selected);
      const hasTrapping = est.estimate.hasTrapping === true;
      const pmName: string | null = est.pm || null;

      // ----- Annual Inspection (533) -----
      let aiResult: any = null;
      if (st.ai) {
        aiResult = { status: 'already created (state)', subscriptionID: st.ai };
      } else if (!resolved) {
        aiResult = { status: 'skipped — no qualifying guarantee (12mo/none/unknown)', selected };
      } else if (await customerHasService(office, customerId, ANNUAL_INSPECTION_SERVICE)) {
        aiResult = { status: 'skipped — already has 533', guarantee: resolved.name };
        st.ai = 'existing';
      } else {
        const soldBy = pmName ? await pmNameToFrId(office, pmName) : null;
        if (dry) {
          aiResult = { status: 'WOULD CREATE 533', guarantee: resolved.name, months: resolved.term.months, noExpiration: resolved.term.noExpiration, soldBy, pmName };
        } else {
          const res = await createAnnualInspection(office, { customerId, exclusionDate, term: resolved.term, soldBy });
          aiResult = { status: res.ok ? 'CREATED 533' : 'FAILED 533', subscriptionID: res.subscriptionID, guarantee: resolved.name, soldBy, detail: res.detail };
          if (res.ok) st.ai = res.subscriptionID;
        }
      }

      // ----- Trap Check (504) — only if trapping in proposal -----
      let trapResult: any = null;
      if (hasTrapping) {
        if (st.trap) {
          trapResult = { status: 'already created (state)', subscriptionID: st.trap };
        } else if (await customerHasService(office, customerId, TRAP_CHECK_SERVICE)) {
          trapResult = { status: 'skipped — already has 504' };
          st.trap = 'existing';
        } else {
          const soldBy = pmName ? await pmNameToFrId(office, pmName) : null;
          if (dry) {
            trapResult = { status: 'WOULD CREATE 504', soldBy };
          } else {
            const res = await createTrapCheck(office, { customerId, soldBy });
            trapResult = { status: res.ok ? 'CREATED 504' : 'FAILED 504', subscriptionID: res.subscriptionID, detail: res.detail };
            if (res.ok) st.trap = res.subscriptionID;
          }
        }
      }

      if (!dry) { st.at = new Date().toISOString(); state[customerId] = st; }
      actions.push({ office, customerId, exclusionDate, guarantee: resolved?.name || null, hasTrapping, annualInspection: aiResult, trapCheck: trapResult });
    }
  }

  if (!dry) await prisma.appSetting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });

  const createdAI = actions.filter(a => a.annualInspection?.status?.startsWith('CREATED')).length;
  const createdTrap = actions.filter(a => a.trapCheck?.status?.startsWith('CREATED')).length;
  const wouldAI = actions.filter(a => a.annualInspection?.status?.startsWith('WOULD')).length;
  return NextResponse.json({ dry, window: `${from} to ${to}`, completedExclusions: actions.length, createdAI, createdTrap, wouldCreateAI: wouldAI, actions });
}
