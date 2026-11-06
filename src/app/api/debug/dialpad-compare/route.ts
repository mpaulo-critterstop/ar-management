// TEMP: compare last-month call legs: Dialpad API vs our dialpad_calls table, for one agent.
// Reveals whether we're missing legs (incomplete sync) that would throw off missed/abandoned counts.
// GET ?token=critterstop2026&agent=Marlon%20Marzon
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function getConfig(key: string) {
  const row = await prisma.$queryRaw<Array<{ value: string }>>`SELECT value FROM dialpad_config WHERE key = ${key} LIMIT 1`;
  return row[0]?.value || null;
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const apiKey = await getConfig('dialpad_api_key');
  if (!apiKey) return NextResponse.json({ error: 'no api key' }, { status: 400 });

  // last month window (ms)
  const now = new Date();
  const lmStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const lmEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1;

  // DB count for last month (all inbound user legs)
  const dbRows = await prisma.$queryRaw<any[]>`
    SELECT COUNT(*) AS legs,
      COUNT(*) FILTER (WHERE date_connected IS NOT NULL) AS answered,
      COUNT(*) FILTER (WHERE date_connected IS NULL AND state != 'abandoned') AS missed,
      COUNT(*) FILTER (WHERE state = 'abandoned') AS abandoned
    FROM dialpad_calls
    WHERE direction='inbound' AND target_type='user'
      AND date_started >= ${lmStart} AND date_started <= ${lmEnd}
  `;

  // API: page through last month's calls, count inbound user-target legs
  let cursor: string | null = null; let apiLegs = 0; let apiUserLegs = 0; let pages = 0; const stateCounts: Record<string, number> = {};
  do {
    const p = new URLSearchParams({ limit: '100', started_after: String(Math.floor(lmStart/1000)), started_before: String(Math.floor(lmEnd/1000)) });
    if (cursor) p.set('cursor', cursor);
    const r = await fetch(`https://dialpad.com/api/v2/call?${p.toString()}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
    const j = await r.json();
    const items = j?.items || [];
    apiLegs += items.length;
    for (const c of items) {
      if (c.direction === 'inbound' && c.target?.type === 'user') apiUserLegs++;
      stateCounts[c.state || 'none'] = (stateCounts[c.state || 'none'] || 0) + 1;
    }
    cursor = j?.cursor || null; pages++;
    if (pages > 30) break;
  } while (cursor);

  return NextResponse.json({
    window: { from: new Date(lmStart).toISOString(), to: new Date(lmEnd).toISOString() },
    db: { legs: Number(dbRows[0].legs), answered: Number(dbRows[0].answered), missed: Number(dbRows[0].missed), abandoned: Number(dbRows[0].abandoned) },
    api: { totalLegsAllTypes: apiLegs, inboundUserLegs: apiUserLegs, pages, stateCounts },
    note: 'If api.inboundUserLegs > db.legs, the sync is missing legs for last month.',
  });
}
