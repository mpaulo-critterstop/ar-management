import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FR_SUB = 'critterstoppest';
const BASE = `https://${FR_SUB}.fieldroutes.com/api`;
const CREDS: Record<string, { key?: string; token?: string }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW, token: process.env.FIELDROUTES_TOKEN_DFW },
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = sp.get('date') || '2026-10-05';
  const frId = sp.get('frId') || '10171'; // Megan
  const cfg = CREDS.DFW;
  const auth = `&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

  // Fetch routes fresh from FR for the date, showing assignedTech AND additionalTechs (the crew).
  const rs = await fetch(`${BASE}/route/search?${auth}`).then(r => r.json());
  const ids: string[] = (rs.routeIDs || []).slice(-3000);
  const routesOnDate: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100).join(',');
    const rd = await fetch(`${BASE}/route/get?routeIDs=${batch}${auth}`).then(r => r.json());
    (rd.routes || []).forEach((r: any) => {
      if (r.date === date) {
        const crew = (r.additionalTechs ? String(r.additionalTechs).split(',').map((s: string) => s.trim()).filter(Boolean) : []);
        if (r.assignedTech && String(r.assignedTech) !== '0') crew.push(String(r.assignedTech));
        routesOnDate.push({ routeID: r.routeID, assignedTech: String(r.assignedTech), additionalTechs: r.additionalTechs || '', crew: [...new Set(crew)] });
      }
    });
  }
  const meganRoutes = routesOnDate.filter(r => r.crew.includes(frId));
  // also stored route-customer rows for this tech+date
  const megan = await prisma.technician.findFirst({ where: { frEmployeeId: Number(frId), status: 'ACTIVE' }, select: { techId: true, name: true } });
  let storedRows = 0;
  if (megan) {
    const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`SELECT COUNT(*)::bigint cnt FROM tech_route_customers WHERE "techId" = ${megan.techId} AND "date" = ${new Date(date + 'T12:00:00.000Z')}`;
    storedRows = Number(rows[0]?.cnt || 0);
  }
  return NextResponse.json({
    date, frId, megan,
    routesOnDate: routesOnDate.length,
    meganRoutesViaCreW: meganRoutes,
    storedRouteCustomerRows: storedRows,
    note: 'meganRoutesViaCreW shows routes where frId is in the crew (assignedTech OR additionalTechs). storedRouteCustomerRows = after a fresh route build, how many customers are now credited to her.',
  });
}
