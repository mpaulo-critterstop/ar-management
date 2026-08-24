// Reconcile stale invoice status: any invoice that is fully paid (paid >= amount, amount > 0) but whose
// status is NOT 'PAID' gets corrected to 'PAID'. Root cause was the dispatch closeout stamping status from
// the closeout DATE without checking the balance (now fixed) — this cleans up the ones already stuck.
//   Dry run:  /api/cron/reconcile-invoice-status?dry=1&token=critterstop2026
//   Live:     /api/cron/reconcile-invoice-status?token=critterstop2026
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';

  // Fully-paid invoices not marked PAID. Use a raw query so we can compare two columns (paid >= amount).
  const stale = await prisma.$queryRawUnsafe(`
    SELECT id, "externalId", status, amount, paid, office
    FROM invoices
    WHERE amount > 0 AND paid >= amount AND status <> 'PAID'
    ORDER BY office
  `) as any[];

  const byStatus: Record<string, number> = {};
  for (const s of stale) byStatus[s.status] = (byStatus[s.status] || 0) + 1;

  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, count: stale.length, byPriorStatus: byStatus,
      sample: stale.slice(0, 50).map(s => ({ invoiceId: s.externalId || s.id, office: s.office, priorStatus: s.status, amount: Number(s.amount).toFixed(2), paid: Number(s.paid).toFixed(2) })),
    });
  }

  // Live: flip them to PAID in one bulk update.
  const ids = stale.map(s => s.id);
  let updated = 0;
  if (ids.length) {
    const res = await prisma.invoice.updateMany({ where: { id: { in: ids } }, data: { status: 'PAID' } });
    updated = res.count;
  }
  return NextResponse.json({ ok: true, dry: false, corrected: updated, byPriorStatus: byStatus });
}
