// TEMP: dump a RAW sample of the Dialpad /call API response to see the native outcome/state fields,
// so we classify missed/abandoned using Dialpad's own data instead of inferring from timing.
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
  // last ~2 days of calls, small page
  const started_after = Date.now() - 2 * 86400000;
  const params = new URLSearchParams({ started_after: String(started_after), limit: '5' });
  const r = await fetch(`https://dialpad.com/api/v2/call?${params.toString()}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  const j = await r.json();
  const calls = j?.items || j?.calls || [];
  // Return ALL keys of the first few calls so we can see what Dialpad natively provides.
  return NextResponse.json({
    status: r.status,
    sampleKeys: calls[0] ? Object.keys(calls[0]) : [],
    samples: calls.slice(0, 5).map((c: any) => ({
      id: c.call_id || c.id, state: c.state, direction: c.direction,
      was_recorded: c.was_recorded, date_connected: c.date_connected, date_started: c.date_started, date_ended: c.date_ended,
      duration: c.duration, total_duration: c.total_duration, entry_point_call_id: c.entry_point_call_id,
      target: c.target, contact: c.contact?.name, event_timestamp: c.event_timestamp,
      // dump any field that smells like an outcome
      outcome: c.outcome, disposition: c.disposition, call_outcome: c.call_outcome, missed: c.missed, is_abandoned: c.is_abandoned, was_answered: c.was_answered,
      _full: c,
    })),
  });
}
