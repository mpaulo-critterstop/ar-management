import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const fr = req.nextUrl.searchParams.get('fr') || '52568';
  const row = await prisma.appSetting.findUnique({ where: { key: `excl_estimate:${fr}` } });
  if (!row) return NextResponse.json({ found: false });
  const rec = JSON.parse(row.value);
  return NextResponse.json({ found: true, frCustomerId: rec.frCustomerId, pm: rec.pm, computedAt: rec.computedAt, acceptedAt: rec.acceptedAt,
    estimateKeys: rec.estimate ? Object.keys(rec.estimate) : null,
    guaranteeGroup: rec.estimate?.guaranteeGroup, selectedGroups: rec.estimate?.selectedGroups, hasTrapping: rec.estimate?.hasTrapping });
}
