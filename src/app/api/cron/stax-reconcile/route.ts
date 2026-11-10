// Stax poll safety-net — re-pulls recent Stax transactions and runs each through the bridge (idempotent:
// already-recorded ones are skipped). Catches payments the webhook missed (e.g. during a DB outage), since
// Stax returns 200 to the webhook and won't retry. Replaces the defunct Helcim-era helcim-sync poll.
//   GET ?token=critterstop2026[&pages=5][&dry=1]
import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders, processStaxTransaction } from '@/lib/staxBridge';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const pages = Math.min(parseInt(sp.get('pages') || '5'), 20);
  const headers = staxHeaders();

  const summary: Record<string, number> = { scanned: 0, written: 0, already_written: 0, onsite: 0, declined: 0, flagged: 0, skipped: 0, other: 0 };
  const recovered: any[] = [];

  for (let page = 1; page <= pages; page++) {
    const r = await fetch(`${STAX_BASE}/transaction?page=${page}&per_page=50`, { headers });
    const j = await r.json().catch(() => null);
    const data = j?.data || [];
    if (!Array.isArray(data) || !data.length) break;
    for (const txn of data) {
      const type = String(txn?.type || '').toLowerCase();
      if (type !== 'charge' && type !== 'capture') continue;
      summary.scanned++;
      if (dry) continue;
      const result = await processStaxTransaction(txn, 'poll').catch((e) => ({ status: 'error', reason: String(e) } as any));
      const st = result?.status || 'other';
      summary[st] = (summary[st] || 0) + 1;
      // a freshly 'written' one here = recovered (the webhook had missed it)
      if (st === 'written') recovered.push({ txn: txn.id, amount: txn.total, invoice: txn?.meta?.fr_invoice || null });
    }
  }

  return NextResponse.json({ ok: true, dry, pagesScanned: pages, summary, recoveredCount: recovered.length, recovered: recovered.slice(0, 50) });
}
