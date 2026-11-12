import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  // Month start in UTC vs Central (CST = UTC-6) vs Pacific (PST = UTC-8)
  const utcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const centralStart = utcStart + 6 * 3600000;   // Nov 1 00:00 Central = Nov 1 06:00 UTC
  const pacificStart = utcStart + 8 * 3600000;    // Nov 1 00:00 Pacific = Nov 1 08:00 UTC
  const earlierStart = utcStart - 8 * 3600000;    // catch calls late on Oct 31 Pacific that are Nov 1 UTC... (other direction)
  try {
    const q = (start: number) => prisma.$queryRaw<any[]>`
      SELECT COUNT(*) FILTER (WHERE date_connected IS NOT NULL)::int AS answered
      FROM dialpad_calls WHERE target_name='Geovany Miranda' AND direction='inbound' AND target_type='user'
        AND date_started >= ${start}`;
    const [utc, central, pacific, earlier] = await Promise.all([q(utcStart), q(centralStart), q(pacificStart), q(earlierStart)]);
    // also: latest synced call for Geo (to check sync lag)
    const latest = await prisma.$queryRaw<any[]>`
      SELECT MAX(date_started) AS latest FROM dialpad_calls WHERE target_name='Geovany Miranda'`;
    return NextResponse.json({
      answered_utc_monthstart: utc[0].answered,
      answered_central_monthstart: central[0].answered,
      answered_pacific_monthstart: pacific[0].answered,
      answered_including_late_oct: earlier[0].answered,
      latest_geo_call_ms: latest[0].latest ? Number(latest[0].latest) : null,
      note: 'Dialpad says 227. See which timezone boundary matches.',
    });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
