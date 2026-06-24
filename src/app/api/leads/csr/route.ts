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
  const csrEmployeeId = searchParams.get('csrEmployeeId');

  const where: any = {};
  if (from || to) {
    where.lead = { inspectionDate: {} };
    if (from) where.lead.inspectionDate.gte = new Date(from);
    if (to) where.lead.inspectionDate.lte = new Date(to);
  }
  if (csrEmployeeId) where.csrEmployeeId = csrEmployeeId;

  const csrLeads = await prisma.csrLead.findMany({
    where,
    include: {
      csrEmployee: true,
      lead: { select: { inspectionDate: true, office: true, status: true } },
    },
  });

  // Aggregate by CSR
  const csrMap: Record<string, any> = {};
  for (const cl of csrLeads) {
    const key = cl.frEmployeeId;
    if (!csrMap[key]) {
      csrMap[key] = {
        frEmployeeId: cl.frEmployeeId,
        csrEmployeeId: cl.csrEmployeeId,
        name: cl.csrName || cl.csrEmployee?.name || `FR Employee ${cl.frEmployeeId}`,
        active: cl.csrEmployee?.active ?? true,
        totalPoints: 0,
        originalBookings: 0,
        rescheduled: 0,
        totalLeads: 0,
      };
    }
    csrMap[key].totalPoints += cl.points;
    csrMap[key].totalLeads += 1;
    if (cl.role === 'original') csrMap[key].originalBookings += 1;
    if (cl.role === 'rescheduler') csrMap[key].rescheduled += 1;
  }

  const csrStats = Object.values(csrMap).sort((a: any, b: any) => b.totalPoints - a.totalPoints);

  // KPIs
  const totalPoints = csrStats.reduce((s: number, c: any) => s + c.totalPoints, 0);
  const totalLeads = csrLeads.filter(cl => cl.role === 'original').length;
  const totalRescheduled = csrLeads.filter(cl => cl.role === 'rescheduler').length;
  const activeCSRs = new Set(csrStats.filter((c: any) => c.active).map((c: any) => c.frEmployeeId)).size;

  return NextResponse.json({
    csrStats,
    kpis: { totalPoints, totalLeads, totalRescheduled, activeCSRs },
  });
}
