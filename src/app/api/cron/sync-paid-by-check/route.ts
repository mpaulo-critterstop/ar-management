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
const PAID_BY_CHECK_FLAG = 'Paid by Check';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026' && sp.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const office = sp.get('office') || 'DFW';
  const dry = sp.get('dry') === '1';
  const creds = OFFICE_CREDS[office];
  if (!creds) return NextResponse.json({ error: `no creds for ${office}` }, { status: 400 });
  const auth = `authenticationKey=${creds.key}&authenticationToken=${creds.token}`;

  // 1. Page through all customer-flag records, collecting FR customerIDs with "Paid by Check" = On.
  const paidByCheckFrIds = new Set<string>();
  let url = `${FR_BASE}/customerFlag/search?${auth}&includeData=1`;
  let pages = 0, totalRecords = 0;
  while (url && pages < 40) {
    pages++;
    const r = await fetch(url);
    const j = await r.json();
    if (j.success !== true) break;
    const recs = j.customerFlags || [];
    totalRecords += recs.length;
    for (const f of recs) {
      if (f.flag === PAID_BY_CHECK_FLAG && String(f.flagValue).toLowerCase() === 'on') {
        paidByCheckFrIds.add(String(f.customerID));
      }
    }
    const remaining = j.customerIDsNoDataExported || [];
    if (remaining.length > 0) {
      url = `${FR_BASE}/customerFlag/search?${auth}&customerIDs=${remaining.slice(0, 1000).join(',')}&includeData=1`;
    } else {
      url = '';
    }
  }

  // 2. Map FR customerIDs → Hub customers (externalId), and reconcile paidByCheck on/off.
  const hubCustomers = await prisma.customer.findMany({
    where: { office, externalSource: 'fieldroutes' },
    select: { id: true, externalId: true, paidByCheck: true, commercialAccount: true, masterAccountId: true, billToAccountId: true },
  });

  let setOn = 0, setOff = 0;
  const nowOn: string[] = [];
  for (const c of hubCustomers) {
    const shouldBeOn = c.externalId ? paidByCheckFrIds.has(c.externalId) : false;
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
    hubCustomersSetOn: setOn, hubCustomersSetOff: setOff,
    note: 'Customers flagged "Paid by Check" in FR are now excluded from AR/PestAI collections outreach (excludeFromAutomation=true) until the flag is removed.',
    sampleNewlyExcluded: nowOn.slice(0, 20),
  });
}
