import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const inv = sp.get('inv') || '226875';
  // find his collections tracker row(s)
  const rows = await prisma.collectionsTracker.findMany({ where: { invoiceNumber: inv } });
  // also the invoice record (to see current balance/dates)
  const invoice = await prisma.invoice.findFirst({ where: { externalId: inv }, select: { externalId: true, amount: true, paid: true, due: true, status: true, customer: { select: { name: true, externalId: true } } } });

  if (sp.get('confirm') === '1' && rows.length) {
    // mark as REMOVED (off the table) — not PAID (he still owes, just not SCC-eligible)
    await prisma.collectionsTracker.updateMany({ where: { invoiceNumber: inv, stage: { notIn: ['PAID','REMOVED'] } }, data: { stage: 'REMOVED' } });
    const after = await prisma.collectionsTracker.findMany({ where: { invoiceNumber: inv }, select: { stage: true } });
    return NextResponse.json({ removed: true, nowStages: after.map(r => r.stage) });
  }
  return NextResponse.json({
    invoice,
    trackerRows: rows.map(r => ({ id: r.id, customerName: r.customerName, track: r.track, stage: r.stage, amount: Number(r.amount), enteredAt: r.enteredAt, dueDate: r.dueDate })),
    note: 'add &confirm=1 to remove from the SCC/collections table (sets stage=REMOVED)',
  });
}
