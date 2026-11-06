// TEMP: dump the get_agent_stats / get_call_stats function definitions so we can see how 'missed' is counted
// and update them to exclude 'abandoned'. GET ?token=critterstop2026
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const fns = await prisma.$queryRaw<Array<{ name: string; def: string }>>`
    SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('get_agent_stats','get_call_stats','get_tracking_stats')
  `;
  return NextResponse.json({ functions: fns });
}
