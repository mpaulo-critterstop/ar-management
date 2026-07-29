import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Targeted single-customer refresh from FieldRoutes.
// Fixes placeholder "Customer <id>" records whose full details were never pulled
// (e.g. their ticket fell outside the window the broader sync processed).
//
// Usage: GET /api/sync/customer?token=critterstop2026&office=DFW&customerId=48988
//   - office defaults to DFW (the AR module's primary office)
//   - customerId is the FieldRoutes customer ID
// Mirrors the exact name/detail mapping used by /api/sync/fieldroutes so records stay consistent.

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';

const OFFICES: Record<string, { key: string; token: string; officeId: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: '1' },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: '5' },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: '3' },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: '4' },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const office = searchParams.get('office') || 'DFW';
  const customerId = searchParams.get('customerId');
  if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 });

  const cfg = OFFICES[office];
  if (!cfg?.key) return NextResponse.json({ error: `Unknown or unconfigured office: ${office}` }, { status: 400 });

  const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

  // Fetch the customer from FR
  let fc: any;
  try {
    const res = await fetch(`${BASE_URL}/customer/get?customerIDs=${encodeURIComponent(customerId)}&${auth}`, {
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json();
    fc = (data.customers || [])[0];
  } catch (e: any) {
    return NextResponse.json({ error: `FieldRoutes fetch failed: ${e.message}` }, { status: 502 });
  }

  if (!fc) return NextResponse.json({ error: `Customer ${customerId} not found in FieldRoutes (office ${office})` }, { status: 404 });

  // Same mapping as /api/sync/fieldroutes
  const name = [fc.fname, fc.lname].filter(Boolean).join(' ') || fc.companyName || `Customer ${fc.customerID}`;
  const status = fc.status === 1 || fc.status === '1' ? 'ACTIVE' : 'SUSPENDED';
  const custId = String(fc.customerID);
  const commercial = fc.commercialAccount === 1 || fc.commercialAccount === '1';
  const masterRaw = String(fc.masterAccount ?? '0');
  const hasMaster = masterRaw !== '0' && masterRaw !== '' && masterRaw !== custId;
  const billToRaw = String(fc.billToAccountID ?? custId);
  const billsElsewhere = billToRaw !== '0' && billToRaw !== '' && billToRaw !== custId;
  const excludeFromAutomation = commercial || hasMaster || billsElsewhere;

  const updateData = {
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
  };

  const existing = await prisma.customer.findFirst({
    where: { externalId: custId, externalSource: 'fieldroutes', office },
  });

  let action: string;
  if (existing) {
    await prisma.customer.update({ where: { id: existing.id }, data: updateData });
    action = 'updated';
  } else {
    // No record for this office — create one so it's not lost.
    await prisma.customer.create({
      data: { ...updateData, externalId: custId, externalSource: 'fieldroutes', office },
    });
    action = 'created';
  }

  return NextResponse.json({
    ok: true,
    action,
    office,
    customerId: custId,
    name,
    email: updateData.email ?? null,
    phone: updateData.phone ?? null,
    excludeFromAutomation,
  });
}
