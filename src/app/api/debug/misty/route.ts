import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const leads = await prisma.lead.findMany({
    where: { OR: [{ customerName: { contains: 'Misty', mode: 'insensitive' } }, { customerId: '52188' }] },
    select: { id: true, externalId: true, customerId: true, customerName: true, status: true, pmName: true, leadType: true, inspectionDate: true, office: true, serviceType: true },
  });
  const insp = await prisma.pestInspection.findMany({ where: { customerId: '52188' }, select: { externalId: true, status: true } });
  const appts = await prisma.$queryRawUnsafe(`SELECT "externalId","status" FROM csr_appointments WHERE "customerId"='52188'`) as any[];
  return NextResponse.json({ leadTable: leads, pestInspections: insp, csrAppointments: appts });
}
