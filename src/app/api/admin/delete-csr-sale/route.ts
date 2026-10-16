// Admin: delete a miscredited CSR pest sale + exclude it from future syncs so it doesn't reappear.
//   GET ?token=...&customerId=51632            -> PREVIEW matching CSR sales (no change)
//   GET ?token=...&customerId=51632&apply=1    -> delete them + add their externalKeys to the sync exclusion list
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const session = await getServerSession(authOptions);
  const tokenOk = sp.get('token') === 'critterstop2026';
  if (!session && !tokenOk) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session && (session.user as any)?.role !== 'Admin' && !tokenOk) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const customerId = sp.get('customerId');
  const externalKey = sp.get('externalKey'); // optional: target one exact sale
  if (!customerId && !externalKey) return NextResponse.json({ error: 'customerId or externalKey required' }, { status: 400 });
  const apply = sp.get('apply') === '1';

  const where: any = { sellerType: 'csr' };
  if (externalKey) where.externalKey = externalKey;
  else where.customerId = customerId;

  const matches = await prisma.pestSale.findMany({
    where,
    select: { id: true, externalKey: true, customerId: true, customerName: true, category: true, sellerName: true, soldByFrId: true, contractValue: true, saleDate: true, office: true },
  });

  if (!apply) {
    return NextResponse.json({ mode: 'PREVIEW (add &apply=1 to delete)', count: matches.length, records: matches });
  }

  // Delete + add externalKeys to the persistent sync-exclusion list so they don't re-sync.
  const keys = matches.map(m => m.externalKey);
  const existing = await prisma.appSetting.findUnique({ where: { key: 'pest_sale_excluded_keys' } }).catch(() => null);
  const prior: string[] = existing?.value ? JSON.parse(existing.value) : [];
  const merged = [...new Set([...prior, ...keys])];
  await prisma.appSetting.upsert({
    where: { key: 'pest_sale_excluded_keys' },
    create: { key: 'pest_sale_excluded_keys', value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  });
  const del = await prisma.pestSale.deleteMany({ where: { externalKey: { in: keys }, sellerType: 'csr' } });

  return NextResponse.json({ mode: 'APPLIED', deleted: del.count, excludedKeys: keys, totalExcludedNow: merged.length, records: matches });
}
