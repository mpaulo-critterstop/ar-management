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
  const paidFilter = req.nextUrl.searchParams.get('paid') || 'all'; // 'all' | 'unpaid' | 'paid'
  const noOffice = !office || office === 'All' || office === 'ALL' || office === 'all';
  const officeFilter = noOffice ? '' : `AND i.office = '${office!.replace(/'/g, "''")}'`;

  // NOTE: membership is a FROZEN SNAPSHOT. The list is built once via POST { action: 'rebuild' } and
  // does NOT auto-add invoices that go overdue later — the regular call-sheet process handles those.
  // (Previously this GET auto-stamped every qualifying invoice on load; that's intentionally removed.)

  // Show all MEMBERS (blitzListedAt set), including now-paid ones. Still exclude staged/excluded.
  const invoices = await prisma.$queryRawUnsafe(`
    SELECT i.id, i."customerId", i.date, i.due, i.amount, i.paid, i."serviceType", i."serviceId",
           i."arNote", i.office, i."blitzAssignedTo", i.status,
           c.name as "customerName", c.phone, c.email, c."serviceAddr"
    FROM invoices i
    JOIN customers c ON c.id = i."customerId"
    WHERE i."blitzListedAt" IS NOT NULL
      AND i."arStage" IS NULL
      AND c."excludeFromAutomation" = false
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
    where: { OR: [{ modules: { has: 'ar' } }, { role: { in: ['Admin', 'ADMIN', 'LEADERSHIP'] } }] },
    select: { id: true, name: true, office: true, username: true },
    orderBy: { name: 'asc' },
  });
  const userName = new Map(users.map(u => [u.id, u.name]));

  const role = (session.user as any)?.role;
  const isAdmin = role === 'Admin' || role === 'ADMIN' || role === 'LEADERSHIP';

  const MS_DAY = 86400000;
  const now = Date.now();
  let items = invoices.map(inv => {
    const daysOverdue = Math.floor((now - new Date(inv.due).getTime()) / MS_DAY);
    const last = lastNoteByInvoice.get(inv.id);
    const outstanding = Number(inv.amount) - Number(inv.paid);
    const isPaid = outstanding <= 0 || inv.status === 'PAID';
    return {
      invoiceId: inv.id,
      customerId: inv.customerId,
      customerName: inv.customerName,
      phone: inv.phone,
      serviceAddr: inv.serviceAddr,
      serviceType: inv.serviceType,
      serviceCategory: WILDLIFE_IDS.includes(Number(inv.serviceId)) ? 'Wildlife' : 'Pest Control',
      office: inv.office,
      outstanding: Math.max(0, outstanding),
      paid: isPaid,
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

  // Paid filter.
  if (paidFilter === 'unpaid') items = items.filter(i => !i.paid);
  else if (paidFilter === 'paid') items = items.filter(i => i.paid);

  // Unpaid first (oldest overdue first), paid sink to the bottom.
  items.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    return b.daysOverdue - a.daysOverdue;
  });

  return NextResponse.json({
    count: items.length,
    unpaidCount: items.filter(i => !i.paid).length,
    paidCount: items.filter(i => i.paid).length,
    totalOutstanding: items.reduce((s, i) => s + i.outstanding, 0),
    assignableUsers: users.map(u => ({ id: u.id, name: u.name, office: u.office, username: u.username })),
    isAdmin,
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

// POST: auto-distribute the backlog evenly across a roster, balanced within aging buckets.
// { userIds: string[], office?, scope?: 'all'|'unassigned' }  (default scope 'all' = reshuffle everything)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Admin-only: distribution reshuffles everyone's slices.
  if ((session.user as any)?.role !== 'Admin' && !((session.user as any)?.role === 'ADMIN')) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));

  // ── REBUILD action: clear the whole blitz list, then stamp today's overdue set as a FROZEN
  //    snapshot. Nothing auto-adds after this — the regular process handles new overdue invoices.
  if (b.action === 'rebuild') {
    // 1) Clear ALL current membership + assignments (paid, unpaid, assigned — everything).
    await prisma.$executeRawUnsafe(`
      UPDATE invoices SET "blitzListedAt" = NULL, "blitzAssignedTo" = NULL
      WHERE "blitzListedAt" IS NOT NULL OR "blitzAssignedTo" IS NOT NULL
    `);
    // 2) Stamp every currently-overdue, unpaid, non-excluded invoice as a member (as of now).
    await prisma.$executeRawUnsafe(`
      UPDATE invoices i
      SET "blitzListedAt" = NOW()
      FROM customers c
      WHERE c.id = i."customerId"
        AND i.due IS NOT NULL AND i.due < NOW()
        AND i.paid < i.amount AND i.amount > 0
        AND i."arStage" IS NULL
        AND c."excludeFromAutomation" = false
    `);
    const count = await prisma.invoice.count({ where: { blitzListedAt: { not: null } } });
    return NextResponse.json({ ok: true, rebuilt: true, members: count });
  }

  const userIds: string[] = Array.isArray(b.userIds) ? b.userIds : [];
  const office: string | undefined = b.office;
  const scope: string = b.scope === 'unassigned' ? 'unassigned' : 'all';
  if (userIds.length === 0) return NextResponse.json({ error: 'userIds required' }, { status: 400 });

  const noOffice = !office || office === 'All' || office === 'ALL' || office === 'all';

  // Pull the backlog (same filter as GET).
  const invoices = await prisma.invoice.findMany({
    where: {
      due: { not: null, lt: new Date() },
      arStage: null,
      customer: { excludeFromAutomation: false },
      ...(noOffice ? {} : { office: { equals: office!, mode: 'insensitive' } }),
    },
    select: { id: true, due: true, amount: true, paid: true, blitzAssignedTo: true },
  });
  const backlog = invoices.filter(i =>
    Number(i.paid) < Number(i.amount) &&
    (scope === 'all' || !i.blitzAssignedTo)
  );

  // Bucket by aging.
  const MS_DAY = 86400000;
  const now = Date.now();
  const bucketOf = (due: Date) => {
    const d = Math.floor((now - new Date(due).getTime()) / MS_DAY);
    if (d <= 30) return 0;
    if (d <= 60) return 1;
    if (d <= 90) return 2;
    if (d <= 180) return 3;
    return 4;
  };
  const buckets: Record<number, typeof backlog> = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  for (const inv of backlog) buckets[bucketOf(inv.due as Date)].push(inv);

  // Per-person caps: caps[userId] = how many that person gets. Falls back to a uniform perPerson.
  // Everything beyond the caps stays unassigned = CSR pool.
  const capsInput: Record<string, number> = (b.caps && typeof b.caps === 'object') ? b.caps : {};
  const uniformPer: number = Number.isFinite(Number(b.perPerson)) && Number(b.perPerson) > 0 ? Math.floor(Number(b.perPerson)) : 0;
  const capFor = (uid: string): number => {
    const c = Number(capsInput[uid]);
    if (Number.isFinite(c) && c > 0) return Math.floor(c);
    return uniformPer; // 0 = unlimited
  };
  const anyCap = userIds.some(uid => capFor(uid) > 0);

  // Build ONE age-sorted stream (oldest first).
  const stream = [...backlog].sort((a, b2) => new Date(a.due as Date).getTime() - new Date(b2.due as Date).getTime());

  const assignments = new Map<string, string>(); // invoiceId -> userId
  const assignedCount: Record<string, number> = {};
  for (const uid of userIds) assignedCount[uid] = 0;

  // To give EVERYONE (and the leftover pool) a proportional spread of new+old, we STRIDE through the
  // age-sorted stream rather than taking contiguous age bands. Total to assign = sum of caps (bounded
  // by backlog). We pick that many invoices EVENLY across the whole age range, then round-robin those
  // picks across people by their cap weights. The un-picked invoices (also evenly spread by age)
  // become the CSR pool — so the pool isn't all-newest or all-oldest either.
  const totalToAssign = anyCap
    ? Math.min(stream.length, userIds.reduce((s, uid) => s + (capFor(uid) || 0), 0))
    : stream.length;

  if (totalToAssign > 0) {
    // Evenly sample `totalToAssign` indices across the sorted stream (stride sampling).
    const picks: number[] = [];
    if (totalToAssign >= stream.length) {
      for (let i = 0; i < stream.length; i++) picks.push(i);
    } else {
      const step = stream.length / totalToAssign;
      for (let k = 0; k < totalToAssign; k++) picks.push(Math.floor(k * step));
    }
    // Assign picks to people, respecting each person's cap; round-robin so each person's set is also
    // spread across the picks (which are themselves age-spread).
    let rr = 0;
    for (const idx of picks) {
      // next person under cap
      let placed = false;
      for (let t = 0; t < userIds.length; t++) {
        const uid = userIds[(rr + t) % userIds.length];
        if (capFor(uid) > 0 && assignedCount[uid] >= capFor(uid)) continue;
        if (!anyCap && false) continue;
        assignments.set(stream[idx].id, uid);
        assignedCount[uid]++;
        rr = (rr + t + 1) % userIds.length;
        placed = true;
        break;
      }
      if (!placed) break; // everyone capped
    }
  }

  // Apply in batches.
  const entries = [...assignments.entries()];
  const perUserCount: Record<string, number> = {};
  for (const [, uid] of entries) perUserCount[uid] = (perUserCount[uid] || 0) + 1;

  // Update by grouping invoice ids per user (fewer queries).
  const byUser = new Map<string, string[]>();
  for (const [invId, uid] of entries) {
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(invId);
  }
  for (const [uid, ids] of byUser) {
    await prisma.invoice.updateMany({ where: { id: { in: ids } }, data: { blitzAssignedTo: uid } });
  }
  // If scope=all, clear assignments for anyone not in the roster? No — only touched matched invoices.

  return NextResponse.json({
    ok: true,
    distributed: entries.length,
    perUser: perUserCount,
    buckets: { '1-30': buckets[0].length, '31-60': buckets[1].length, '61-90': buckets[2].length, '91-180': buckets[3].length, '181+': buckets[4].length },
  });
}
