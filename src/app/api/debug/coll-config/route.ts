import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await prisma.appSetting.findUnique({ where: { key: 'collections_config' } });
  const stored = row?.value ? JSON.parse(row.value) : null;
  if (req.nextUrl.searchParams.get('fix') === '1' && stored) {
    stored.badDebtDaysAfterARM = 45;
    await prisma.appSetting.update({ where: { key: 'collections_config' }, data: { value: JSON.stringify(stored) } });
    return NextResponse.json({ fixed: true, badDebtDaysAfterARM: stored.badDebtDaysAfterARM, badDebtDaysAfterSCC: stored.badDebtDaysAfterSCC });
  }
  return NextResponse.json({ storedConfig: stored, note: stored ? 'add &fix=1 to set ARM=45' : 'no stored config — code default (45) applies' });
}
