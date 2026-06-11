// src/app/api/cron/sync-addresses/route.ts
// Pulls customer service addresses from FieldRoutes and updates the DB
// Run once to backfill, then weekly to catch new customers

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 100;

const OFFICES: Record<string, { key: string; token: string; officeId: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: '1' },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: '5' },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: '3' },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: '4' },
};

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`FR ${endpoint} failed: ${res.status}`);
  return res.json();
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    const session = await getServerSession(authOptions);
    if (!session || !['ADMIN', 'MANAGER'].includes((session.user as any)?.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const log: string[] = [];
  let totalUpdated = 0;
  const errors: string[] = [];

  for (const [officeName, cfg] of Object.entries(OFFICES)) {
    if (!cfg.key || !cfg.token) continue;

    try {
      log.push(`\n--- ${officeName} ---`);

      // Search all customers for this office
      const searchData = await frFetch('customer/search', `officeIDs=${cfg.officeId}`, cfg.key, cfg.token);
      const customerIds: number[] = searchData.customerIDs || [];
      log.push(`Found ${customerIds.length} customers`);

      // Fetch in batches
      let updated = 0;
      for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
        const batch = customerIds.slice(i, i + BATCH_SIZE);
        const data = await frFetch('customer/get', `customerIDs=${batch.join(',')}`, cfg.key, cfg.token);
        const customers = Array.isArray(data.customers)
          ? data.customers
          : Object.values(data.customers || {});

        for (const fc of customers as any[]) {
          try {
            const externalId = String(fc.customerID);

            // Build service address (prefer service address over billing)
            const serviceAddr = [
              fc.serviceAddress || fc.address,
              fc.serviceCity || fc.city,
              fc.serviceState || fc.state,
              fc.serviceZip || fc.zip,
            ].filter(Boolean).join(', ') || null;

            const billingAddr = [
              fc.address,
              fc.city,
              fc.state,
              fc.zip,
            ].filter(Boolean).join(', ') || null;

            if (!serviceAddr && !billingAddr) continue;

            // Update customer in DB by externalId
            const result = await prisma.customer.updateMany({
              where: { externalId, externalSource: 'fieldroutes' },
              data: {
                serviceAddr,
                billingAddr,
                updatedAt: new Date(),
              },
            });

            if (result.count > 0) updated++;
          } catch (e: any) {
            errors.push(`Customer ${fc.customerID}: ${e.message}`);
          }
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      }

      log.push(`${officeName}: updated ${updated} customers`);
      totalUpdated += updated;

    } catch (e: any) {
      const msg = `${officeName} error: ${e.message}`;
      errors.push(msg);
      log.push(msg);
    }
  }

  log.push(`\nTotal updated: ${totalUpdated}`);

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    totalUpdated,
    errors: errors.slice(0, 20),
    log: log.join('\n'),
  });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const total = await prisma.customer.count();
  const withAddr = await prisma.customer.count({ where: { serviceAddr: { not: null } } });
  const withGeo = await prisma.$queryRaw<[{count: bigint}]>`SELECT COUNT(*) as count FROM customers WHERE lat IS NOT NULL`;

  return NextResponse.json({
    total,
    withServiceAddr: withAddr,
    geocoded: Number(withGeo[0].count),
    remaining: withAddr - Number(withGeo[0].count),
  });
}
