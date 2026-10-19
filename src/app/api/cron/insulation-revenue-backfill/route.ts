// One-time historical backfill for Insulation Revenue per Tech. Computes + caches every WEEK (and MONTH) from a
// start date up to now, all offices. Chisam wants a baseline back to ~September.
//   GET ?token=...&from=2026-09-01   (defaults to 2026-09-01)
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026' && req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const from = new Date((sp.get('from') || '2026-09-01') + 'T12:00:00.000Z');
  const base = process.env.NEXTAUTH_URL || `https://${req.headers.get('host')}`;
  const now = new Date();

  // Build the list of Monday week-start keys from `from` to now.
  const weekKeys: string[] = [];
  const d = new Date(from);
  // snap to Monday
  const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  while (d <= now) { weekKeys.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }

  // Monthly keys (YYYY-MM) spanned.
  const monthKeys = [...new Set(weekKeys.map(k => k.slice(0, 7)))];

  const done: string[] = [];
  // Trigger each week (sequential, each backgrounds its own compute). Spacing avoids hammering FR.
  for (const wk of weekKeys) {
    try { await fetch(`${base}/api/cron/insulation-revenue?token=critterstop2026&refresh=1&period=week&date=${wk}`, { signal: AbortSignal.timeout(30000) }); done.push(`week ${wk}`); }
    catch { done.push(`week ${wk} (triggered)`); }
    await new Promise(r => setTimeout(r, 2000));
  }
  for (const mk of monthKeys) {
    try { await fetch(`${base}/api/cron/insulation-revenue?token=critterstop2026&refresh=1&period=month&date=${mk}`, { signal: AbortSignal.timeout(30000) }); done.push(`month ${mk}`); }
    catch { done.push(`month ${mk} (triggered)`); }
    await new Promise(r => setTimeout(r, 2000));
  }
  return NextResponse.json({ ok: true, from: from.toISOString().slice(0, 10), weeks: weekKeys.length, months: monthKeys.length, triggered: done, note: 'Each period computes in the background; allow several minutes for all to populate.' });
}
