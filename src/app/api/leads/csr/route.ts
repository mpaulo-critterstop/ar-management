import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  // Get valid leadIds based on appointmentDate filter
  let validLeadIds: Set<string> | null = null;
  if (from || to) {
    const conditions: string[] = [];
    const params: any[] = [];
    if (from) { conditions.push(`"appointmentDate" >= $${params.length + 1}`); params.push(new Date(from)); }
    if (to) { conditions.push(`"appointmentDate" <= $${params.length + 1}`); params.push(new Date(to + 'T23:59:59')); }

    const appts = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "externalId" FROM "csr_appointments" WHERE ${conditions.join(' AND ')}`,
      ...params
    );

    // Build all possible ID formats used as leadId in csr_leads
    validLeadIds = new Set();
    for (const a of appts) {
      validLeadIds.add(a.id);
      validLeadIds.add(`wild_dfw_${a.externalId}`);
      validLeadIds.add(`wild_${a.externalId}`);
      validLeadIds.add(`csr_appt_${a.externalId}`);
    }
  }

  const csrLeads = await prisma.csrLead.findMany({
    include: { csrEmployee: true },
  });

  // Filter by date and hide FR Employee 0
  const filteredLeads = csrLeads.filter(cl => {
    if (cl.frEmployeeId === '0') return false;
    if (validLeadIds && !validLeadIds.has(cl.leadId)) return false;
    return true;
  });

  // Aggregate by CSR name
  const csrMap: Record<string, any> = {};
  for (const cl of filteredLeads) {
    const key = cl.csrName || `FR Employee ${cl.frEmployeeId}`;
    if (!csrMap[key]) {
      csrMap[key] = {
        name: key,
        active: cl.csrEmployee?.active ?? true,
        totalPoints: 0,
        originalBookings: 0,
        rescheduled: 0,
        uniqueLeadIds: new Set<string>(),
      };
    }
    csrMap[key].totalPoints += cl.points;
    csrMap[key].uniqueLeadIds.add(cl.leadId);
    if (cl.role === 'original') csrMap[key].originalBookings += 1;
    if (cl.role === 'rescheduler') csrMap[key].rescheduled += 1;
  }

  const csrStats = Object.values(csrMap).map((c: any) => ({
    ...c,
    totalLeads: c.uniqueLeadIds.size,
    uniqueLeadIds: undefined,
  })).sort((a: any, b: any) => b.totalPoints - a.totalPoints);

  const totalPoints = csrStats.reduce((s: number, c: any) => s + c.totalPoints, 0);
  const totalLeads = filteredLeads.filter(cl => cl.role === 'original').length;
  const totalRescheduled = filteredLeads.filter(cl => cl.role === 'rescheduler').length;
  const activeCSRs = new Set(
    csrStats.filter((c: any) => c.active && !c.name.startsWith('FR Employee')).map((c: any) => c.name)
  ).size;

  return NextResponse.json({
    csrStats,
    kpis: { totalPoints, totalLeads, totalRescheduled, activeCSRs },
  });
}
