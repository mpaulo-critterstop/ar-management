import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const csrName = searchParams.get('csrName');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!csrName) return NextResponse.json({ error: 'csrName required' }, { status: 400 });

  // Get all frEmployeeIds for this CSR name
  const employees = await prisma.csrEmployee.findMany({
    where: { name: csrName },
    select: { frEmployeeId: true },
  });
  const frEmployeeIds = employees.map(e => e.frEmployeeId);

  // Also get frEmployeeIds for all OTHER CSRs (for "rescheduled by" and "originally booked by" lookups)
  const allEmployees = await prisma.csrEmployee.findMany({
    select: { frEmployeeId: true, name: true },
  });
  const employeeNameMap: Record<string, string> = {};
  for (const e of allEmployees) {
    employeeNameMap[e.frEmployeeId] = e.name;
  }

  // Get date-filtered appointment IDs
  let apptWhere = '';
  const params: any[] = [];
  if (from) { params.push(new Date(from)); apptWhere += ` AND ca."appointmentDate" >= $${params.length}`; }
  if (to) { params.push(new Date(to + 'T23:59:59')); apptWhere += ` AND ca."appointmentDate" <= $${params.length}`; }

  // Get all csr_leads for this CSR with appointment details
  const frIdList = frEmployeeIds.map(id => `'${id}'`).join(',');
  if (!frIdList) return NextResponse.json({ completed: [], rescheduledByOthers: [], rescheduledFromOthers: [] });

  const leads = await prisma.$queryRawUnsafe<any[]>(`
    SELECT 
      cl.id, cl."leadId", cl."frEmployeeId", cl.role, cl.points,
      ca."externalId", ca."appointmentDate", ca.office, ca."serviceTypeName",
      ca."originalAppointmentId", ca."employeeId" as "completedEmployeeId"
    FROM "csr_leads" cl
    JOIN "csr_appointments" ca ON cl."leadId" = ca.id
    WHERE cl."frEmployeeId" IN (${frIdList})
    ${apptWhere}
    ORDER BY ca."appointmentDate" DESC
  `, ...params);

  // For rescheduled by others — find who rescheduled (the rescheduler's employeeId)
  // These are original bookings with 0.5 points — need to find the rescheduler
  const rescheduledByOthersAppts = leads.filter(l => l.role === 'original' && Number(l.points) === 0.5);
  
  // For each, find the rescheduler from csr_leads with same leadId and role=rescheduler
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

  // For rescheduled from others — find who originally booked
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

  // Build response
  const formatDate = (d: any) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const completed = leads
    .filter(l => l.role === 'original' && Number(l.points) === 1.0)
    .map(l => ({
      date: formatDate(l.appointmentDate),
      office: l.office,
      serviceType: l.serviceTypeName === 'wildlife' ? 'Wildlife Inspection' : (l.serviceTypeName || '—'),
    }));

  const rescheduledByOthers = rescheduledByOthersAppts.map(l => ({
    date: formatDate(l.appointmentDate),
    office: l.office,
    serviceType: l.serviceTypeName === 'wildlife' ? 'Wildlife Inspection' : (l.serviceTypeName || '—'),
    rescheduledBy: reschedulerMap[l.leadId] || 'Unknown',
  }));

  const rescheduledFromOthers = rescheduledFromOthersAppts.map(l => ({
    date: formatDate(l.appointmentDate),
    office: l.office,
    serviceType: l.serviceTypeName === 'wildlife' ? 'Wildlife Inspection' : (l.serviceTypeName || '—'),
    originallyBookedBy: originalBookerMap[l.leadId] || 'Unknown',
  }));

  return NextResponse.json({ completed, rescheduledByOthers, rescheduledFromOthers });
}
