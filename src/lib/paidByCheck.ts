// Live "Paid by Check" verification — used at the moment of a PestAI/AR collections send so the flag is
// always fresh (a customer flagged Paid-by-Check an hour ago is honored immediately, not only after a nightly
// sync). FR's customerFlag/search is reliable per single customer (bulk pagination is broken — see
// sync-paid-by-check), so we check one customer at a time, which is exactly the shape needed here.
import { prisma } from '@/lib/prisma';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICE_CREDS: Record<string, { key: string; token: string }> = {
  DFW: {
    key: '6t0i20austp8ts2ln5296vi45qifgjrh08bbpfp1svijke8enjpr8d55qo81nsml',
    token: 'uinj35806p728f9bktr984gsml74a8to077g6ufpjcvlk7v5g0bgqe256l2nn5gb',
  },
};
const PAID_BY_CHECK_FLAG = 'Paid by Check';

// Returns true if the customer is currently flagged "Paid by Check" in FR. Also updates the Hub's
// paidByCheck + excludeFromAutomation so the state persists. On any FR error returns `null` (inconclusive —
// caller should NOT skip on null, i.e. fail-open to sending, since a missed send is less harmful than wrongly
// chasing — but here we actually fail-SAFE: treat inconclusive as "don't block", because the nightly sync +
// the Hub flag already provide a backstop). customerHubId optional (to persist the flag).
export async function isPaidByCheck(office: string, customerExternalId: string | null | undefined, customerHubId?: string | null): Promise<boolean> {
  const creds = OFFICE_CREDS[office];
  if (!creds || !customerExternalId) return false;
  const auth = `authenticationKey=${creds.key}&authenticationToken=${creds.token}`;
  try {
    const j = await fetch(`${FR_BASE}/customerFlag/search?${auth}&customerIDs=${customerExternalId}&includeData=1`).then(r => r.json());
    if (j?.success !== true) return false; // inconclusive → don't block the send; backstops handle it
    const flagged = (j.customerFlags || []).some((f: any) => f.flag === PAID_BY_CHECK_FLAG && String(f.flagValue).toLowerCase() === 'on');
    // Persist to the Hub so other surfaces (collections tracker, reports) stay consistent.
    if (customerHubId) {
      const c = await prisma.customer.findUnique({ where: { id: customerHubId }, select: { paidByCheck: true, commercialAccount: true, masterAccountId: true, billToAccountId: true } });
      if (c && c.paidByCheck !== flagged) {
        const otherExclusions = c.commercialAccount || !!c.masterAccountId || !!c.billToAccountId;
        await prisma.customer.update({ where: { id: customerHubId }, data: { paidByCheck: flagged, excludeFromAutomation: otherExclusions || flagged } }).catch(() => {});
      }
    }
    return flagged;
  } catch {
    return false; // FR error → don't block; nightly sync + stored flag are the backstop
  }
}
