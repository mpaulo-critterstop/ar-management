// AR Blitz call sheet — the all-hands backlog view (separate from the cadence-based call sheet).
// Shows EVERY overdue invoice with raw days-overdue, supports per-person assignment for the blitz.
// GET   /api/ar/blitz[?office=DFW][&assignee=<userId|unassigned>]
// PATCH /api/ar/blitz  { invoiceId, blitzAssignedTo }   (assign/unassign; null = unassign)
// Mark Called reuses POST /api/ar/call-sheet (logs a CollectionNote). Escalation reuses the stages PATCH.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';

const WILDLIFE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'ar')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const office = req.nextUrl.searchParams.get('office');
  const assignee = req.nextUrl.searchParams.get('assignee'); // userId, 'unassigned', or null (all)
  const noOffice = !office || office === 'All' || office === 'ALL' || office === 'all';
  const officeFilter = noOffice ? '' : `AND i.office = '${office!.replace(/'/g, "''")}'`;

  // Every overdue, unpaid invoice — full backlog, no cadence minimum. Exclude escalated/staged ones.
  const invoices = await prisma.$queryRawUnsafe(`
    SELECT i.id, i."customerId", i.date, i.due, i.amount, i.paid, i."serviceType", i."serviceId",
           i."arNote", i.office, i."blitzAssignedTo",
           c.name as "customerName", c.phone, c.email, c."serviceAddr"
    FROM invoices i
    JOIN customers c ON c.id = i."customerId"
    WHERE i.due IS NOT NULL
      AND i.due < NOW()
      AND i.paid < i.amount
      AND i.amount > 0
      AND i."arStage" IS NULL
      ${officeFilter}
    ORDER BY i.due ASC
  `) as any[];

  // Latest call note per invoice (for the "last call" hint).
  const invoiceIds = invoices.map(i => i.id);
  const notes = invoiceIds.length ? await prisma.collectionNote.findMany({
    where: { invoiceId: { in: invoiceIds } },
    orderBy: { date: 'desc' },
    select: { invoiceId: true, date: true, text: true, status: true },
  }) : [];
  const lastNoteByInvoice = new Map<string, any>();
  for (const n of notes) { if (n.invoiceId && !lastNoteByInvoice.has(n.invoiceId)) lastNoteByInvoice.set(n.invoiceId, n); }

  // Assignable users (AR module access) for the dropdown + name lookup.
  const users = await prisma.user.findMany({
    where: { OR: [{ modules: { has: 'ar' } }, { role: { in: ['ADMIN', 'LEADERSHIP'] } }] },
    select: { id: true, name: true, office: true },
    orderBy: { name: 'asc' },
  });
  const userName = new Map(users.map(u => [u.id, u.name]));

  const MS_DAY = 86400000;
  const now = Date.now();
  let items = invoices.map(inv => {
    const daysOverdue = Math.floor((now - new Date(inv.due).getTime()) / MS_DAY);
    const last = lastNoteByInvoice.get(inv.id);
    return {
      invoiceId: inv.id,
      customerId: inv.customerId,
      customerName: inv.customerName,
      phone: inv.phone,
      serviceAddr: inv.serviceAddr,
      serviceType: inv.serviceType,
      serviceCategory: WILDLIFE_IDS.includes(Number(inv.serviceId)) ? 'Wildlife' : 'Pest Control',
      office: inv.office,
      outstanding: Number(inv.amount) - Number(inv.paid),
      daysOverdue,
      arNote: inv.arNote || '',
      assignedTo: inv.blitzAssignedTo || null,
      assignedToName: inv.blitzAssignedTo ? (userName.get(inv.blitzAssignedTo) || 'Unknown') : null,
      lastNote: last ? { text: last.text, date: last.date } : null,
    };
  });

  // Optional assignee filter.
  if (assignee === 'unassigned') items = items.filter(i => !i.assignedTo);
  else if (assignee) items = items.filter(i => i.assignedTo === assignee);

  items.sort((a, b) => b.daysOverdue - a.daysOverdue); // oldest first

  return NextResponse.json({
    count: items.length,
    totalOutstanding: items.reduce((s, i) => s + i.outstanding, 0),
    assignableUsers: users.map(u => ({ id: u.id, name: u.name, office: u.office })),
    items,
  });
}

// Assign / unassign an invoice for the blitz.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'ar')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const { invoiceId, blitzAssignedTo } = b;
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });
  await prisma.invoice.update({ where: { id: invoiceId }, data: { blitzAssignedTo: blitzAssignedTo || null } });
  return NextResponse.json({ ok: true });
}
