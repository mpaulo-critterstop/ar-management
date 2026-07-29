import { prisma } from '@/lib/prisma';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

// Finds AR customer records still named "Customer <id>" (placeholders created by the invoice/
// appointment sync before their details were pulled) and enriches them from FieldRoutes in
// batches. Safe to run at the end of any daily sync — idempotent and rate-limit friendly.
//
// Returns a small summary for logging.
export async function healPlaceholderCustomers(
  office: string,
  key: string,
  token: string,
): Promise<{ found: number; healed: number; stillMissing: number }> {
  // Placeholder records for this office: name looks like "Customer <digits>".
  const placeholders = await prisma.customer.findMany({
    where: {
      office,
      externalSource: 'fieldroutes',
      name: { startsWith: 'Customer ' },
    },
    select: { id: true, externalId: true, name: true },
  });

  // Keep only the ones whose name is exactly the "Customer <externalId>" placeholder pattern
  // (avoid touching a real customer legitimately named e.g. "Customer First Choice LLC").
  const stubs = placeholders.filter(c => c.externalId && c.name === `Customer ${c.externalId}`);
  if (stubs.length === 0) return { found: 0, healed: 0, stillMissing: 0 };

  const ids = stubs.map(c => c.externalId!) as string[];
  let healed = 0;

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    let customers: any[] = [];
    try {
      const res = await fetch(
        `${FR_BASE}/customer/get?customerIDs=${batch.join(',')}&authenticationKey=${key}&authenticationToken=${token}`,
        { signal: AbortSignal.timeout(25000) },
      );
      const data = await res.json();
      customers = data.customers || [];
    } catch {
      continue; // skip this batch on transient FR error; next run retries
    }

    for (const fc of customers) {
      const custId = String(fc.customerID);
      const name = [fc.fname, fc.lname].filter(Boolean).join(' ') || fc.companyName || `Customer ${custId}`;
      // If FR still has no real name, leave the placeholder so it retries next run.
      if (name === `Customer ${custId}`) continue;

      const status = fc.status === 1 || fc.status === '1' ? 'ACTIVE' : 'SUSPENDED';
      const commercial = fc.commercialAccount === 1 || fc.commercialAccount === '1';
      const masterRaw = String(fc.masterAccount ?? '0');
      const hasMaster = masterRaw !== '0' && masterRaw !== '' && masterRaw !== custId;
      const billToRaw = String(fc.billToAccountID ?? custId);
      const billsElsewhere = billToRaw !== '0' && billToRaw !== '' && billToRaw !== custId;
      const excludeFromAutomation = commercial || hasMaster || billsElsewhere;

      const existing = await prisma.customer.findFirst({
        where: { externalId: custId, externalSource: 'fieldroutes', office },
      });
      if (!existing) continue;

      await prisma.customer.update({
        where: { id: existing.id },
        data: {
          name,
          email: fc.email || undefined,
          phone: fc.phone1 || undefined,
          billingAddr: [fc.address, fc.city, fc.state, fc.zip].filter(Boolean).join(', ') || undefined,
          serviceAddr: [fc.serviceAddress || fc.address, fc.serviceCity || fc.city, fc.serviceState || fc.state, fc.serviceZip || fc.zip].filter(Boolean).join(', ') || undefined,
          status: status as any,
          commercialAccount: commercial,
          masterAccountId: hasMaster ? masterRaw : null,
          billToAccountId: billsElsewhere ? billToRaw : null,
          excludeFromAutomation,
        },
      });
      healed++;
    }
  }

  return { found: stubs.length, healed, stillMissing: stubs.length - healed };
}
