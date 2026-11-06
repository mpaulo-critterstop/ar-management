import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // For Marlon's unconnected legs, show categories + entry_point + master + whether the parent CC call was abandoned
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id::text, target_name, state, categories,
      entry_point_call_id::text AS epid, master_call_id::text AS mcid, operator_call_id::text AS ocid,
      (date_ended - date_started) AS span_ms
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL
      AND date_started >= ${start}
      AND target_name = 'Marlon Marzon'
    ORDER BY span_ms
  `;
  // also: distinct categories present across all calls this month (to find an 'abandoned' category)
  const cats = await prisma.$queryRaw<any[]>`
    SELECT DISTINCT categories FROM dialpad_calls
    WHERE date_started >= ${start} AND categories IS NOT NULL AND categories != '' LIMIT 40
  `;
  return NextResponse.json({ marlonUnconnected: rows.map((r:any)=>({state:r.state, categories:r.categories, epid:r.epid, mcid:r.mcid, span_s:(Number(r.span_ms)/1000).toFixed(1)})), distinctCategories: cats.map((c:any)=>c.categories) });
}
