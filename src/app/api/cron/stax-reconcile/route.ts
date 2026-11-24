// Stax poll safety-net — re-pulls recent Stax transactions and runs each through the bridge (idempotent:
// already-recorded ones are skipped). Catches payments the webhook missed (e.g. during a DB outage), since
// Stax returns 200 to the webhook and won't retry. Replaces the defunct Helcim-era helcim-sync poll.
//   GET ?token=critterstop2026[&pages=5][&dry=1]
import { NextRequest, NextResponse } from 'next/server';
import { STAX_BASE, staxHeaders, processStaxTransaction } from '@/lib/staxBridge';
import { FR_OFFICES } from '@/lib/helcimBridge';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

// When Stax voids/returns a charge that we already recorded to FR (e.g. ACH return R03 days later), reverse the
// FR payment via payment/createRefund. Idempotent: the charge's ledger row is flipped to 'ach_returned' once.
async function handleAchVoidByParent(parentChargeId: string, dry: boolean): Promise<{ reversed: boolean; frPaymentId: string | null } | null> {
  const ledger = await prisma.staxPayment.findUnique({ where: { staxTransactionId: parentChargeId } }).catch(() => null);
  if (!ledger || ledger.status !== 'written' || !ledger.frPaymentId) return null; // not ours / not written / already handled
  if (dry) return { reversed: false, frPaymentId: ledger.frPaymentId };
  const office = ledger.office || '';
  const cfg = (FR_OFFICES as any)[office];
  let reversed = false;
  if (cfg) {
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    try {
      const r = await fetch(`${FR_BASE}/payment/createRefund?paymentID=${ledger.frPaymentId}&${auth}`, { method: 'POST' });
      const j = await r.json().catch(() => null);
      reversed = j?.success !== false;
    } catch { /* non-fatal */ }
  }
  await prisma.staxPayment.update({ where: { staxTransactionId: parentChargeId }, data: { status: 'ach_returned', failReason: `Stax voided/returned — FR payment ${ledger.frPaymentId} reversed`, processedAt: new Date() } }).catch(() => {});
  return { reversed, frPaymentId: ledger.frPaymentId };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const pages = Math.min(parseInt(sp.get('pages') || '5'), 20);
  const headers = staxHeaders();

  const summary: Record<string, number> = { scanned: 0, written: 0, already_written: 0, onsite: 0, declined: 0, flagged: 0, skipped: 0, other: 0 };
  const recovered: any[] = [];

  // STALE-CLAIM RECOVERY: a row claimed (processing lock) but never finalized — e.g. the FR write succeeded but
  // the function timed out before marking 'written', or a retry crashed. Such rows are invisible (not shown) and
  // never retried (dedup treats 'claimed' as in-progress forever). Reset claims older than 10 min back to pending
  // so the scan below re-processes them (idempotent: processStaxTransaction re-dedups against FR).
  if (!dry) {
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    const unstuck = await prisma.staxPayment.updateMany({
      where: { status: 'claimed', updatedAt: { lt: staleBefore } },
      data: { status: 'pending' },
    }).catch(() => ({ count: 0 }));
    summary.unstuck_claims = unstuck.count;
  }

  for (let page = 1; page <= pages; page++) {
    const r = await fetch(`${STAX_BASE}/transaction?page=${page}&per_page=50`, { headers });
    const j = await r.json().catch(() => null);
    const data = j?.data || [];
    if (!Array.isArray(data) || !data.length) break;
    for (const txn of data) {
      const type = String(txn?.type || '').toLowerCase();
      // ACH RETURN / VOID detection: Stax voids a charge days later (e.g. R03 ACH return). The VOID transaction
      // itself is recent (so it shows up here), while its parent charge is on an old page. Key off the void and
      // reverse the parent's FR payment. parent_id / transaction_id points to the original charge.
      if (type === 'void' && txn?.success) {
        const parentId = txn?.parent_id || txn?.transaction_id || txn?.parent_transaction_id || null;
        if (parentId) {
          const handled = await handleAchVoidByParent(parentId, dry);
          if (handled) { summary.ach_reversed = (summary.ach_reversed || 0) + 1; if (handled.reversed) recovered.push({ reversal: true, voidTxn: txn.id, parentCharge: parentId, frPaymentId: handled.frPaymentId }); }
        }
        continue;
      }
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
