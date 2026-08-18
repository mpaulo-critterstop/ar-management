import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const office = sp.get('office');
  const from = sp.get('from'); // YYYY-MM-DD — due-window start
  const to = sp.get('to');     // YYYY-MM-DD — due-window end

  const where: any = {};
  if (office && office !== 'All') where.office = office;

  const items = await prisma.servicePoolItem.findMany({ where, orderBy: [{ dueDate: 'asc' }] });

  // Overdue = due date already passed (surfaced prominently, most overdue first).
  const overdue = items.filter(i => i.isOverdue).sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));

  // Due-in-window = not overdue, due date within [from, to] if provided (else all upcoming).
  const inWindow = items.filter(i => {
    if (i.isOverdue) return false;
    if (!i.dueDate) return false;
    const d = i.dueDate.toISOString().slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  const sum = (arr: any[]) => Math.round(arr.reduce((a, r) => a + (r.contractValue || 0), 0));
  const offices = [...new Set(items.map(i => i.office))].sort();
  const lastSync = items[0]?.syncedAt || null;

  return NextResponse.json({
    overdue, inWindow,
    totals: {
      overdueCount: overdue.length, overdueCV: sum(overdue),
      windowCount: inWindow.length, windowCV: sum(inWindow),
    },
    offices, lastSync,
  });
}
