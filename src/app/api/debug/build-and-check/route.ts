// One-click: rebuild DFW routes (all chunks) for the week + report route-62872 crew mapping + Megan's stored rows.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const weekEnd = sp.get('weekEnd') || '2026-10-11';
  const date = sp.get('date') || '2026-10-05';
  const frId = sp.get('frId') || '10171';
  const office = sp.get('office') || 'DFW';
  const base = process.env.NEXTAUTH_URL || `https://${req.headers.get('host')}`;

  const chunkLogs: any[] = [];
  let totalRoutes = 0;
  for (let offset = 0, guard = 0; guard < 30; offset += 30, guard++) {
    const reset = offset === 0 ? '&reset=true' : '';
    const rr = await fetch(`${base}/api/field-performance/routeCustomers?token=critterstop2026&weekEnd=${weekEnd}&office=${office}&offset=${offset}&limit=30${reset}`, { signal: AbortSignal.timeout(300000) });
    const rj = await rr.json().catch(() => ({} as any));
    totalRoutes = rj.totalRoutes || totalRoutes;
    const log = rj.log || '';
    const route62872Line = log.split('\n').find((l: string) => l.includes('62872')) || null;
    const savedLines = log.split('\n').filter((l: string) => l.includes('Saved ' + date));
    chunkLogs.push({ offset, totalRoutes: rj.totalRoutes, route62872Line, savedLines });
    if (!totalRoutes || offset + 30 >= totalRoutes) break;
  }

  // Megan's stored rows now
  const megan = await prisma.technician.findFirst({ where: { frEmployeeId: Number(frId), status: 'ACTIVE' }, select: { techId: true, name: true } });
  let storedRows = 0;
  if (megan) {
    const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`SELECT COUNT(*)::bigint cnt FROM tech_route_customers WHERE "techId" = ${megan.techId} AND "date" = ${new Date(date + 'T12:00:00.000Z')}`;
    storedRows = Number(rows[0]?.cnt || 0);
  }

  return NextResponse.json({ weekEnd, date, office, totalRoutes, megan, storedRouteCustomerRows: storedRows, chunks: chunkLogs });
}
