import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const apply = sp.get('apply') === '1';
  const current = await prisma.technician.findMany({
    where: { OR: [{ name: { contains: 'Delph' } }, { name: { contains: 'Arzola' } }] },
    select: { techId: true, name: true, status: true, bouncieDevice: { select: { id: true, deviceId: true, bouncieName: true } } },
  });
  if (!apply) {
    return NextResponse.json({ mode: 'PREVIEW (add &apply=1 to fix)', current, plannedFix: 'Megan (ACTIVE) device imei -> 865612075874715' });
  }
  const megan = current.find(t => t.name.includes('Delph') && t.status === 'ACTIVE' && t.bouncieDevice);
  let result: any = {};
  if (megan?.bouncieDevice?.id) {
    await prisma.bouncieDevice.update({ where: { id: megan.bouncieDevice.id }, data: { deviceId: '865612075874715' } });
    result.megan = 'set I-007 device imei -> 865612075874715';
  } else result.megan = 'Megan active device not found';
  const after = await prisma.technician.findMany({
    where: { OR: [{ name: { contains: 'Delph' } }, { name: { contains: 'Arzola' } }] },
    select: { techId: true, name: true, status: true, bouncieDevice: { select: { deviceId: true, bouncieName: true } } },
  });
  return NextResponse.json({ mode: 'APPLIED', result, after });
}
