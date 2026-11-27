import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const inv = sp.get('inv') || '226875';
  // find his collections tracker row(s)
  const rows = await prisma.collectionsTracker.findMany({ where: { invoiceNumber: inv } });
  if (sp.get('confirm') === '1') {
    // remove him from the table: mark stage REMOVED (drops out of all active tabs)
    for (const r of rows) {
      await prisma.collectionsTracker.update({ where: { id: r.id }, data: { stage: 'REMOVED' } });
    }
    return NextResponse.json({ removed: rows.map(r => r.id), customer: rows[0]?.customerName });
  }
  return NextResponse.json({ invoice: inv, rows: rows.map(r => ({ id: r.id, customer: r.customerName, track: r.track, stage: r.stage, amount: r.amount, enteredAt: r.enteredAt, dueDate: r.dueDate })), note: 'add &confirm=1 to remove from table (stage REMOVED)' });
}
