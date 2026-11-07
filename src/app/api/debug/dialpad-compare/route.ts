// TEMP: raw Dialpad API response shape check.
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
  const started_after = Math.floor((Date.now() - 5 * 86400000) / 1000);
  const r = await fetch(`https://dialpad.com/api/v2/call?${new URLSearchParams({ started_after: String(started_after), limit: '10' })}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch {}
  return NextResponse.json({
    status: r.status,
    topLevelKeys: j ? Object.keys(j) : [],
    rawFirst600: text.slice(0, 600),
  });
}
