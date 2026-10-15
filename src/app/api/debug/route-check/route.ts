import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const frId = Number(sp.get('frId') || '10171');
  const weekEnd = sp.get('weekEnd') || '2026-10-11';
  const megan = await prisma.technician.findFirst({ where: { frEmployeeId: frId, status: 'ACTIVE' }, select: { techId: true, name: true } });
  if (!megan) return NextResponse.json({ error: 'tech not found' });
  const rows = await prisma.$queryRaw<any[]>`
    SELECT to_char("date",'YYYY-MM-DD') d,
           to_char("startTime" AT TIME ZONE 'America/Chicago','HH24:MI') startc,
           to_char("finishTime" AT TIME ZONE 'America/Chicago','HH24:MI') finishc,
           to_char("updatedAt",'MM-DD HH24:MI:SS') upd
    FROM payroll_attendance WHERE "techId" = ${megan.techId}
      AND "date" >= ${new Date('2026-10-05T00:00:00Z')} AND "date" <= ${new Date('2026-10-11T23:59:59Z')}
    ORDER BY "date"`;
  const rc = await prisma.$queryRaw<any[]>`
    SELECT to_char("date",'YYYY-MM-DD') d, COUNT(*)::int cnt FROM tech_route_customers
    WHERE "techId" = ${megan.techId} AND "weekEnd" = ${new Date(weekEnd + 'T00:00:00.000Z')} GROUP BY "date" ORDER BY d`;
  return NextResponse.json({ megan, serverTime: new Date().toISOString(), payrollAttendance: rows, routeCustomersByDay: rc });
}
