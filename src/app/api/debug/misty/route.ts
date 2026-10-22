import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Internal customer for FR 52188
  const cust = await prisma.customer.findFirst({ where: { externalId: '52188' }, select: { id: true, name: true } });
  const leads = cust ? await prisma.lead.findMany({
    where: { customerId: cust.id },
    select: { id: true, externalId: true, pmName: true, status: true, inspectionDate: true, office: true, invoiceId: true },
  }) : [];
  const insp = await prisma.pestInspection.findMany({ where: { customerId: '52188' }, select: { externalId: true, status: true } });
  const appts = await prisma.$queryRawUnsafe(`SELECT "externalId","status" FROM csr_appointments WHERE "customerId"='52188'`) as any[];
  return NextResponse.json({ customer: cust, leadTable: leads, pestInspections: insp, csrAppointments: appts });
}
