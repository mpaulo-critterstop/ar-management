// TEMP: test the Stats API records-export flow (request -> status -> download shape).
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

  const checkId = req.nextUrl.searchParams.get('check');
  const H = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  // If checking an existing request id:
  if (checkId) {
    const r = await fetch(`https://dialpad.com/api/v2/stats/${checkId}`, { headers: H });
    const j = await r.json();
    return NextResponse.json({ mode: 'check', status: r.status, body: j });
  }

  // Otherwise, submit a new stats request for the last ~2 days.
  const now = new Date();
  const start = Math.floor((Date.now() - 2 * 86400000) / 1000);
  const end = Math.floor(Date.now() / 1000);
  const body = { stat_type: 'call', export_type: 'records', days_ago_start: 2, days_ago_end: 0 };
  const r = await fetch('https://dialpad.com/api/v2/stats', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  return NextResponse.json({ mode: 'submit', status: r.status, requestBody: body, response: j });
}
