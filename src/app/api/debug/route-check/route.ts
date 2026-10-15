import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Show Bouncie device assignments for Megan + Tito/Homero Arzola to find the mis-mapping
  const techs = await prisma.technician.findMany({
    where: { OR: [{ name: { contains: 'Delph' } }, { name: { contains: 'Arzola' } }] },
    select: { techId: true, name: true, status: true, frEmployeeId: true, bouncieDevice: { select: { deviceId: true, bouncieName: true } } },
  });
  // All bouncie devices (to see names vs deviceIds)
  const devices = await prisma.bouncieDevice.findMany({
    select: { deviceId: true, bouncieName: true, technician: { select: { techId: true, name: true } } },
  });
  const relevant = devices.filter(d => /delph|arzola|tito|homero/i.test(d.bouncieName) || /delph|arzola/i.test(d.technician?.name || ''));
  return NextResponse.json({ techsWithDevices: techs, relevantDevices: relevant });
}
