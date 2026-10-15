import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = sp.get('date') || '2026-10-05';
  const dateObj = new Date(date + 'T12:00:00.000Z');
  const rows = await prisma.$queryRaw<Array<{ techId: string; cnt: bigint }>>`
    SELECT "techId", COUNT(*)::bigint as cnt FROM tech_route_customers WHERE "date" = ${dateObj} GROUP BY "techId" ORDER BY cnt DESC`;
  const megan = await prisma.technician.findMany({
    where: { name: { contains: 'Delph' } },
    select: { techId: true, name: true, office: true, status: true, frEmployeeId: true },
  });
  // also: does ANY row exist for date regardless of exact timestamp? (date-format check)
  const anyForDay = await prisma.$queryRaw<Array<{ d: string; cnt: bigint }>>`
    SELECT to_char("date",'YYYY-MM-DD HH24:MI:SS') as d, COUNT(*)::bigint as cnt FROM tech_route_customers
    WHERE "date" >= ${new Date(date + 'T00:00:00Z')} AND "date" < ${new Date(date + 'T23:59:59Z')} GROUP BY "date" ORDER BY cnt DESC LIMIT 5`;
  return NextResponse.json({
    date,
    routeCustomersByTech: rows.map(r => ({ techId: r.techId, count: Number(r.cnt) })),
    distinctDateTimestamps: anyForDay.map(r => ({ storedAs: r.d, count: Number(r.cnt) })),
    meganRecords: megan,
  });
}
