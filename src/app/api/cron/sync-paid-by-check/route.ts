// Sync the FieldRoutes "Paid by Check" customer flag → mark those customers paidByCheck=true and exclude them
// from AR/PestAI collections outreach. These customers mail checks; there's a days-to-weeks lag between send
// and deposit, so they look "past due" in the meantime — but we must NOT auto-chase them. The AR team flags
// them "Paid by Check" in FR; this sync honors that flag in the Hub.
//
// FR flag pagination: customerFlag/search&includeData=1 returns up to 1000 flag records + the remaining
// customer IDs in customerIDsNoDataExported — feed those back as customerIDs to page through all of them.
//
//   /api/cron/sync-paid-by-check?token=critterstop2026&office=DFW
//   &dry=1   → preview (no writes)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICE_CREDS: Record<string, { key: string; token: string }> = {
  DFW: {
    key: '6t0i20austp8ts2ln5296vi45qifgjrh08bbpfp1svijke8enjpr8d55qo81nsml',
    token: 'uinj35806p728f9bktr984gsml74a8to077g6ufpjcvlk7v5g0bgqe256l2nn5gb',
  },
};
// Flags that mean "don't chase for payment" — Paid by Check (check in transit) + Financing (Regions/Wisetack,
// billed to the partner at closeout). Override via app_settings 'ar_exclusion_flags'.
const DEFAULT_EXCLUSION_FLAGS = ['Paid by Check', 'Financing'];
async function getExclusionFlags(): Promise<string[]> {
  try { const row = await prisma.appSetting.findUnique({ where: { key: 'ar_exclusion_flags' } }); if (row?.value) { const a = JSON.parse(row.value); if (Array.isArray(a) && a.length) return a; } } catch {}
  return DEFAULT_EXCLUSION_FLAGS;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026' && sp.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const office = sp.get('office') || 'DFW';
  const now = new Date();
  const dry = sp.get('dry') === '1';
  const creds = OFFICE_CREDS[office];
  if (!creds) return NextResponse.json({ error: `no creds for ${office}` }, { status: 400 });
  const auth = `authenticationKey=${creds.key}&authenticationToken=${creds.token}`;

  // FR's customerFlag/search is unreliable for bulk retrieval (caps at 1000 records, no working offset, and
  // scoping by a list of customerIDs truncates to ~1 record — verified). BUT per-customer lookup is reliable.
  // So instead of scanning all ~17,775 flagged customers, we only check the customers that could actually get
  // collection outreach: those with an OVERDUE/unpaid invoice. That's a small set, checked one at a time.
  const overdueCustomerIds = await prisma.invoice.findMany({
    where: { office, due: { not: null, lte: now }, status: { notIn: ['PAID', 'VOID_DELETED'] as any } },
    select: { customerId: true },
    distinct: ['customerId'],
  });
  const custIds = [...new Set(overdueCustomerIds.map(i => i.customerId).filter(Boolean))] as string[];

  const hubCustomers = await prisma.customer.findMany({
    where: { id: { in: custIds } },
    select: { id: true, externalId: true, paidByCheck: true, commercialAccount: true, masterAccountId: true, billToAccountId: true },
  });

  // Check each overdue customer's "Paid by Check" flag directly (reliable per-customer).
  const exclusionFlags = (await getExclusionFlags()).map(s => s.toLowerCase());
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const paidByCheckFrIds = new Set<string>();
  const conclusivelyChecked = new Set<string>(); // customers we got a definitive FR answer for this run
  let pages = 0, totalRecords = 0, inconclusive = 0;
  for (const c of hubCustomers) {
    if (!c.externalId) continue;
    pages++;
    // Throttled per-customer check (~55/min, under FR's 60/min). Retry once on failure so a transient
    // rate-limit/network blip doesn't silently drop a customer who should be excluded.
    let j = await fetch(`${FR_BASE}/customerFlag/search?${auth}&customerIDs=${c.externalId}&includeData=1`).then(r => r.json()).catch(() => null);
    if (!j || j.success !== true) { await sleep(1200); j = await fetch(`${FR_BASE}/customerFlag/search?${auth}&customerIDs=${c.externalId}&includeData=1`).then(r => r.json()).catch(() => null); }
    if (!j || j.success !== true) { inconclusive++; await sleep(300); continue; } // couldn't verify — leave unchanged, don't flip off
    const recs = j.customerFlags || [];
    totalRecords += recs.length;
    conclusivelyChecked.add(c.externalId); // we got a definitive answer for this customer
    if (recs.some((f: any) => exclusionFlags.includes(String(f.flag).toLowerCase()) && String(f.flagValue).toLowerCase() === 'on')) {
      paidByCheckFrIds.add(c.externalId);
    }
    await sleep(1050);
  }

  let setOn = 0, setOff = 0;
  const nowOn: string[] = [];
  for (const c of hubCustomers) {
    const shouldBeOn = c.externalId ? paidByCheckFrIds.has(c.externalId) : false;
    // SAFETY: never flip a customer OFF based on an inconclusive (rate-limited/errored) check — only act on
    // customers we got a definitive FR answer for. An inconclusive check leaves their current state intact,
    // so a transient FR hiccup can't accidentally re-expose a check/financing customer to collections.
    if (!shouldBeOn && c.paidByCheck && !conclusivelyChecked.has(c.externalId || '')) { continue; }
    if (shouldBeOn === c.paidByCheck) continue; // no change
    if (shouldBeOn) { setOn++; nowOn.push(c.externalId!); } else setOff++;
    if (!dry) {
      // Recompute excludeFromAutomation = commercial OR multi-property OR paidByCheck.
      const otherExclusions = c.commercialAccount || !!c.masterAccountId || !!c.billToAccountId;
      await prisma.customer.update({
        where: { id: c.id },
        data: { paidByCheck: shouldBeOn, excludeFromAutomation: otherExclusions || shouldBeOn },
      });
    }
  }

  if (!dry) {
    await prisma.appSetting.upsert({
      where: { key: `paid_by_check_sync_${office}` },
      create: { key: `paid_by_check_sync_${office}`, value: `${new Date().toISOString()} :: flagged ${paidByCheckFrIds.size}, setOn ${setOn}, setOff ${setOff}` },
      update: { value: `${new Date().toISOString()} :: flagged ${paidByCheckFrIds.size}, setOn ${setOn}, setOff ${setOff}` },
    }).catch(() => {});
  }

  return NextResponse.json({
    office, dry, pagesScanned: pages, flagRecordsScanned: totalRecords,
    paidByCheckCustomersInFR: paidByCheckFrIds.size,
    hubCustomersSetOn: setOn, hubCustomersSetOff: setOff, inconclusive,
    note: 'Customers flagged "Paid by Check" in FR are now excluded from AR/PestAI collections outreach (excludeFromAutomation=true) until the flag is removed.',
    sampleNewlyExcluded: nowOn.slice(0, 20),
  });
}
