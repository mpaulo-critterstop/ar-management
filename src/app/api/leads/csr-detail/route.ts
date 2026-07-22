import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'csr')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const csrName = searchParams.get('csrName');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!csrName) return NextResponse.json({ error: 'csrName required' }, { status: 400 });

  // Get all frEmployeeIds for this CSR
  const employees = await prisma.csrEmployee.findMany({
    where: { name: csrName },
    select: { frEmployeeId: true },
  });
  const frEmployeeIds = employees.map(e => e.frEmployeeId);
  if (!frEmployeeIds.length) return NextResponse.json({ completed: [], rescheduledByOthers: [], rescheduledFromOthers: [] });

  const frIdList = frEmployeeIds.map(id => `'${id}'`).join(',');

  // Build date filter
  let dateWhere = '';
  const params: any[] = [];
  if (from) { params.push(new Date(from)); dateWhere += ` AND ca."appointmentDate" >= $${params.length}`; }
  if (to) { params.push(new Date(to + 'T23:59:59')); dateWhere += ` AND ca."appointmentDate" <= $${params.length}`; }

  // Fetch leads with customer name joined
  const leads = await prisma.$queryRawUnsafe<any[]>(`
    SELECT * FROM (
      SELECT DISTINCT ON (cl."leadId", cl.role)
        cl.id, cl."leadId", cl."frEmployeeId", cl.role, cl.points,
        ca."externalId", ca."appointmentDate", ca.office, ca."serviceTypeName",
        ca."originalAppointmentId",
        COALESCE(c.name, '—') as "customerName"
      FROM "csr_leads" cl
      JOIN "csr_appointments" ca ON cl."leadId" = ca.id
      LEFT JOIN "customers" c ON ca."customerId" = c.id OR ca."customerId" = c."externalId"
      WHERE cl."frEmployeeId" IN (${frIdList})
      ${dateWhere}
      ORDER BY cl."leadId", cl.role, ca."appointmentDate" DESC
    ) sub
    ORDER BY "appointmentDate" DESC
  `, ...params);

  // Find reschedulers for "rescheduled by others"
  const rescheduledByOthersAppts = leads.filter(l => l.role === 'original' && Number(l.points) === 0.5);
  const reschedulerLeads = rescheduledByOthersAppts.length > 0 ? await prisma.$queryRawUnsafe<any[]>(`
    SELECT cl."leadId", cl."frEmployeeId", cl."csrName"
    FROM "csr_leads" cl
    WHERE cl."leadId" IN (${rescheduledByOthersAppts.map(l => `'${l.leadId}'`).join(',')})
    AND cl.role = 'rescheduler'
  `) : [];

  const reschedulerMap: Record<string, string> = {};
  for (const r of reschedulerLeads) {
    reschedulerMap[r.leadId] = r.csrName || `FR Employee ${r.frEmployeeId}`;
  }

  // Find original bookers for "rescheduled from others"
  const rescheduledFromOthersAppts = leads.filter(l => l.role === 'rescheduler');
  const originalLeads = rescheduledFromOthersAppts.length > 0 ? await prisma.$queryRawUnsafe<any[]>(`
    SELECT cl."leadId", cl."frEmployeeId", cl."csrName"
    FROM "csr_leads" cl
    WHERE cl."leadId" IN (${rescheduledFromOthersAppts.map(l => `'${l.leadId}'`).join(',')})
    AND cl.role = 'original'
  `) : [];

  const originalBookerMap: Record<string, string> = {};
  for (const r of originalLeads) {
    originalBookerMap[r.leadId] = r.csrName || `FR Employee ${r.frEmployeeId}`;
  }

  const formatDate = (d: any) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const svcType = (t: string) => t || 'Wildlife Inspection';

  const completed = leads
    .filter(l => l.role === 'original' && Number(l.points) === 1.0)
    .map(l => ({
      date: formatDate(l.appointmentDate),
      customer: l.customerName,
      office: l.office,
      serviceType: svcType(l.serviceTypeName),
    }));

  const rescheduledByOthers = rescheduledByOthersAppts.map(l => ({
    date: formatDate(l.appointmentDate),
    customer: l.customerName,
    office: l.office,
    serviceType: svcType(l.serviceTypeName),
    rescheduledBy: reschedulerMap[l.leadId] || 'Unknown',
  }));

  const rescheduledFromOthers = rescheduledFromOthersAppts.map(l => ({
    date: formatDate(l.appointmentDate),
    customer: l.customerName,
    office: l.office,
    serviceType: svcType(l.serviceTypeName),
    originallyBookedBy: originalBookerMap[l.leadId] || 'Unknown',
  }));

  return NextResponse.json({ completed, rescheduledByOthers, rescheduledFromOthers });
}
