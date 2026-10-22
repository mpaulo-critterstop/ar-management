import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Find Misty's PestInspection row(s)
  const insp = await prisma.pestInspection.findMany({
    where: { OR: [{ customerId: '52188' }, { customerName: { contains: 'Misty', mode: 'insensitive' } }] },
    select: { externalId: true, customerId: true, customerName: true, status: true, inspectionDate: true, pmName: true, serviceTypeName: true, office: true, soldInvoiceId: true },
  });
  // Find her csr_appointments rows
  const appts = await prisma.$queryRawUnsafe(`
    SELECT "externalId","customerId","serviceTypeName","appointmentDate","servicedBy","status","office"
    FROM csr_appointments WHERE "customerId" = '52188'
  `) as any[];
  return NextResponse.json({ pestInspections: insp, csrAppointments: appts });
}
