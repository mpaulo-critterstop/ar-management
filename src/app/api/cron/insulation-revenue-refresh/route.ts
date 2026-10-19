// Scheduled wrapper: refreshes the Insulation Revenue per Tech caches (weekly + monthly, all offices) so the
// report is always populated — no more zeros from uncached periods. Triggers the compute for current + previous
// week AND current + previous month across every office. Runs via Vercel cron.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = req.nextUrl.searchParams.get('token');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && token !== 'critterstop2026' && token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const base = process.env.NEXTAUTH_URL || `https://${req.headers.get('host')}`;
  const kicked: string[] = [];
  for (const period of ['week', 'month']) {
    // refresh=1 with no office/date → all offices, current + previous period (backgrounded via waitUntil)
    try {
      await fetch(`${base}/api/cron/insulation-revenue?token=critterstop2026&refresh=1&period=${period}`, { signal: AbortSignal.timeout(60000) });
      kicked.push(period);
    } catch { /* it backgrounds; a timeout on the trigger is fine */ kicked.push(`${period} (triggered)`); }
  }
  return NextResponse.json({ ok: true, triggered: kicked, note: 'Compute runs in background; caches populate within a few minutes.' });
}
