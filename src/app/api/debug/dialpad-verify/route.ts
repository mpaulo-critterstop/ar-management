import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // distinct state values + counts across the whole table — see if state got corrupted
    const states = await prisma.$queryRaw<any[]>`SELECT state, COUNT(*)::text AS n FROM dialpad_calls GROUP BY state ORDER BY COUNT(*) DESC`;
    const recent = await prisma.$queryRaw<any[]>`SELECT id, state, categories, direction, target_type, date_connected IS NOT NULL AS connected FROM dialpad_calls ORDER BY date_started DESC LIMIT 5`;
    return NextResponse.json({ stateCounts: states.map((s:any)=>({state:s.state, n:Number(s.n)})), recentSample: recent.map((r:any)=>({state:r.state, cats:(r.categories||'').slice(0,50), dir:r.direction, tt:r.target_type, connected:r.connected})) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
