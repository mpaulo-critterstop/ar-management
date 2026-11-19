import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
  let withGroups = 0, withoutGroups = 0, total = rows.length;
  const samples: any[] = [];
  for (const r of rows) {
    try {
      const rec = JSON.parse(r.value);
      const sg = rec.estimate?.selectedGroups;
      const hasG = Array.isArray(sg) && sg.some((g: string) => /guarantee|warranty|lifetime/i.test(g));
      if (hasG) withGroups++; else withoutGroups++;
      if (samples.length < 8) samples.push({ frId: rec.frCustomerId, computedAt: rec.computedAt, hasSelectedGroups: Array.isArray(sg), guaranteeInGroups: hasG, guaranteeGroups: Array.isArray(sg) ? sg.filter((g: string) => /guarantee|warranty|lifetime/i.test(g)) : null });
    } catch {}
  }
  return NextResponse.json({ totalEstimates: total, withGuaranteeGroups: withGroups, withoutGuaranteeGroups: withoutGroups, samples });
}
