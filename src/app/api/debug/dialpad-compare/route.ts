// TEMP: check our STORED categories field for abandoned/missed labels (Dialpad's own classification).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const lmStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  // distinct categories values on unconnected user legs last month, with counts
  const cats = await prisma.$queryRaw<any[]>`
    SELECT categories, COUNT(*) AS n
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL
      AND date_started >= ${lmStart}
    GROUP BY categories ORDER BY n DESC LIMIT 20
  `;
  // how many unconnected legs have 'abandoned' in categories vs not
  const summary = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) AS unconnected,
      COUNT(*) FILTER (WHERE categories LIKE '%abandoned%') AS cat_abandoned,
      COUNT(*) FILTER (WHERE categories LIKE '%ring_no_answer%') AS cat_ringnoanswer,
      COUNT(*) FILTER (WHERE categories LIKE '%missed%') AS cat_missed,
      COUNT(*) FILTER (WHERE categories IS NULL OR categories = '') AS cat_empty
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user' AND date_connected IS NULL
      AND date_started >= ${lmStart}
  `;
  return NextResponse.json({
    distinctCategories: cats.map((c:any)=>({categories:c.categories, n:Number(c.n)})),
    summary: Object.fromEntries(Object.entries(summary[0]).map(([k,v])=>[k,Number(v)])),
  });
}
