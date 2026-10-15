import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Megan + Tito device records
  const techs = await prisma.technician.findMany({
    where: { OR: [{ name: { contains: 'Delph' } }, { name: { contains: 'Arzola' } }] },
    select: { techId: true, name: true, status: true, bouncieDevice: { select: { deviceId: true, bouncieName: true } } },
  });
  // All bouncie devices (to see if any share an imei / misassigned)
  const devices = await prisma.bouncieDevice.findMany({
    select: { deviceId: true, bouncieName: true, technician: { select: { techId: true, name: true } } },
  });
  // Check for duplicate deviceIds (two techs sharing one truck's imei)
  const byDevice: Record<string, string[]> = {};
  for (const d of devices) { (byDevice[d.deviceId || 'null'] ||= []).push(`${d.technician?.name} (${d.technician?.techId})`); }
  const dups = Object.entries(byDevice).filter(([, techs]) => techs.length > 1);
  return NextResponse.json({
    meganAndTito: techs,
    duplicateDeviceAssignments: dups.map(([imei, techs]) => ({ imei, techs })),
    totalDevices: devices.length,
  });
}
