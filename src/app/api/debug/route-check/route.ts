import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = sp.get('date') || '2026-10-05';
  const weekEnd = sp.get('weekEnd') || '2026-10-11';
  const dateObj = new Date(date + 'T12:00:00.000Z');

  // 1. The cached FR route list for the week (what routeCustomers fetched). Shows assignedTech per route.
  const routeListCache = await prisma.appSetting.findUnique({ where: { key: `rc_routelist_DFW_${weekEnd}` } });
  const routeList = routeListCache?.value ? JSON.parse(routeListCache.value) : [];
  // routes on this date + their assignedTech (FR id)
  const routesThisDate = routeList.filter((r: any) => r.date === date).map((r: any) => ({ routeID: r.routeID, assignedTech: r.assignedTech }));
  const assignedTechIds = [...new Set(routesThisDate.map((r: any) => String(r.assignedTech)))];

  // 2. All techs with frEmployeeId in that assignedTech set (to see the mapping)
  const techs = await prisma.technician.findMany({
    where: { frEmployeeId: { in: assignedTechIds.map(Number).filter(n => !isNaN(n)) } },
    select: { techId: true, name: true, status: true, frEmployeeId: true, office: true },
  });

  // 3. Is Megan's FR id (10171) among the assignedTechs on her routes?
  const meganFrId = 10171;
  const meganRoutes = routesThisDate.filter((r: any) => String(r.assignedTech) === String(meganFrId));

  return NextResponse.json({
    date, weekEnd,
    totalRoutesInCache: routeList.length,
    routesThisDate: routesThisDate.length,
    assignedTechIdsThisDate: assignedTechIds,
    techsMatchingThoseIds: techs,
    meganFrId,
    meganRoutesThisDate: meganRoutes,
    note: 'If meganRoutesThisDate is empty, Megan\'s FR id 10171 is NOT on any route this date — her route is assigned to a different FR employee id, OR routes aren\'t assigned to her at all.',
  });
}
