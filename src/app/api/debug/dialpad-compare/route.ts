// TEMP: dump the FULL raw API response for a few recent calls to check whether the API provides
// date_first_rang + categories (the fields that distinguish abandoned vs missed in the CSV export).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
async function getConfig(key: string) {
  const row = await prisma.$queryRaw<Array<{ value: string }>>`SELECT value FROM dialpad_config WHERE key = ${key} LIMIT 1`;
  return row[0]?.value || null;
}
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const apiKey = await getConfig('dialpad_api_key');
  if (!apiKey) return NextResponse.json({ error: 'no api key' }, { status: 400 });
  const started_after = Math.floor((Date.now() - 3 * 86400000) / 1000);
  const r = await fetch(`https://dialpad.com/api/v2/call?${new URLSearchParams({ started_after: String(started_after), limit: '20' })}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  const j = await r.json();
  const items = j?.items || [];
  // find unconnected ones (the missed/abandoned candidates) + show the key fields
  const unconnected = items.filter((c: any) => c.direction === 'inbound' && c.target?.type === 'user' && !c.date_connected);
  return NextResponse.json({
    status: r.status,
    allKeysOnFirstItem: items[0] ? Object.keys(items[0]) : [],
    hasDateFirstRang: items[0] ? ('date_first_rang' in items[0]) : null,
    hasCategories: items[0] ? ('categories' in items[0]) : null,
    unconnectedSamples: unconnected.slice(0, 10).map((c: any) => ({
      call_id: c.call_id, state: c.state,
      date_first_rang: c.date_first_rang ?? '(absent)',
      categories: c.categories ?? '(absent)',
      date_started: c.date_started, date_connected: c.date_connected, date_ended: c.date_ended,
    })),
  });
}
