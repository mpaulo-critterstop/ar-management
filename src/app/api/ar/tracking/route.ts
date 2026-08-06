// AR blitz tracking.
//  ?view=leaderboard  -> per-rep: calls made (Dial Pad) + collections credited (payments they processed).
//                        Visible to all AR users.
//  ?view=failsafe     -> ADMIN/LEADERSHIP ONLY. Flags "Mark Called" logs with no matching Dial Pad call.
//
// Collection credit rule: credit the rep whose FR employeeID processed the payment. Self-serve payments
// (portal / ACH / check) credit no one. Requires User.frEmployeeId mapping.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';

// Payment sources/methods that are self-serve → credit no one.
const NO_CREDIT_SOURCES = ['portal', 'ach', 'check', 'e-check', 'echeck', 'bank', 'online', 'web'];
const isSelfServe = (src: string | null) => {
  if (!src) return false;
  const s = src.toLowerCase();
  return NO_CREDIT_SOURCES.some(k => s.includes(k));
};
const digits10 = (s: string | null) => (s ? s.replace(/\D/g, '').slice(-10) : '');

function windowDates(range: string) {
  const now = new Date();
  const start = new Date(now);
  if (range === 'today') start.setHours(0, 0, 0, 0);
  else if (range === '7d') start.setDate(start.getDate() - 7);
  else if (range === '30d') start.setDate(start.getDate() - 30);
  else start.setDate(start.getDate() - 7); // default 7d
  return { start, now };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'ar')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const view = req.nextUrl.searchParams.get('view') || 'leaderboard';
  const range = req.nextUrl.searchParams.get('range') || '7d';
  const { start, now } = windowDates(range);

  const role = (session.user as any)?.role;
  const isAdmin = role === 'Admin' || role === 'ADMIN' || role === 'LEADERSHIP';

  // Users with their Dial Pad + FR mappings.
  const users = await prisma.user.findMany({
    where: { OR: [{ modules: { has: 'ar' } }, { role: { in: ['Admin', 'ADMIN', 'LEADERSHIP'] } }] },
    select: { id: true, name: true, dialpadName: true, frEmployeeId: true },
  });

  if (view === 'failsafe') {
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    // "Mark Called" logs in the window.
    const notes = await prisma.collectionNote.findMany({
      where: { date: { gte: start, lte: now } },
      select: { id: true, date: true, text: true, invoiceId: true, customerId: true, userId: true },
      orderBy: { date: 'desc' },
    });
    if (notes.length === 0) return NextResponse.json({ view, range, flagged: [], checked: 0 });

    // Customer phones for those notes.
    const custIds = [...new Set(notes.map(n => n.customerId).filter(Boolean))] as string[];
    const custs = await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true, phone: true } });
    const custPhone = new Map(custs.map(c => [c.id, digits10(c.phone)]));
    const custName = new Map(custs.map(c => [c.id, c.name]));

    // All Dial Pad calls (any direction) in a slightly padded window, indexed by last-10 digits.
    const pad = new Date(start); pad.setDate(pad.getDate() - 2);
    const calls = await prisma.$queryRawUnsafe(`
      SELECT external_number, date_started FROM dialpad_calls
      WHERE external_number IS NOT NULL AND external_number <> ''
        AND date_started >= ${pad.getTime()}
    `) as any[];
    const calledNumbers = new Set(calls.map(c => digits10(c.external_number)));

    const userName = new Map(users.map(u => [u.id, u.name]));
    // Flag: a note whose customer phone has NO matching Dial Pad call (in or out).
    const flagged = notes
      .map(n => {
        const phone = n.customerId ? custPhone.get(n.customerId) : '';
        const hasCall = phone && phone.length === 10 && calledNumbers.has(phone);
        return { note: n, phone, hasCall };
      })
      .filter(x => !x.hasCall && x.phone) // has a phone but no matching call
      .map(x => ({
        noteId: x.note.id,
        date: x.note.date,
        customerName: x.note.customerId ? custName.get(x.note.customerId) : '—',
        loggedBy: x.note.userId ? (userName.get(x.note.userId) || 'Unknown') : 'Unknown',
        note: x.note.text?.slice(0, 80) || '',
        phone: x.phone,
      }));

    return NextResponse.json({ view, range, checked: notes.length, flaggedCount: flagged.length, flagged });
  }

  // ---- leaderboard ----
  // Calls made per rep (outbound Dial Pad), matched via dialpadName ?? name.
  const nameToUser = new Map<string, string>(); // lowercased dialpad/hub name -> userId
  for (const u of users) {
    nameToUser.set((u.dialpadName || u.name).toLowerCase(), u.id);
    nameToUser.set(u.name.toLowerCase(), u.id);
  }
  const outbound = await prisma.$queryRawUnsafe(`
    SELECT target_name, COUNT(*)::int AS c FROM dialpad_calls
    WHERE direction = 'outbound' AND target_name IS NOT NULL AND target_name <> ''
      AND date_started >= ${start.getTime()} AND date_started <= ${now.getTime()}
    GROUP BY target_name
  `) as any[];
  const callsByUser = new Map<string, number>();
  for (const row of outbound) {
    const uid = nameToUser.get(String(row.target_name).toLowerCase());
    if (uid) callsByUser.set(uid, (callsByUser.get(uid) || 0) + Number(row.c));
  }

  // Collections credited per rep: payments in window whose processedBy maps to a user's frEmployeeId,
  // excluding self-serve sources.
  const frToUser = new Map<string, string>();
  for (const u of users) if (u.frEmployeeId) frToUser.set(String(u.frEmployeeId), u.id);
  const payments = await prisma.payment.findMany({
    where: { date: { gte: start, lte: now }, amount: { gt: 0 }, processedBy: { not: null } },
    select: { amount: true, processedBy: true, paymentSource: true },
  });
  const collectedByUser = new Map<string, number>();
  const countByUser = new Map<string, number>();
  let creditedTotal = 0, selfServeTotal = 0;
  for (const p of payments) {
    if (isSelfServe(p.paymentSource)) { selfServeTotal += Number(p.amount); continue; }
    const uid = p.processedBy ? frToUser.get(String(p.processedBy)) : undefined;
    if (!uid) continue;
    collectedByUser.set(uid, (collectedByUser.get(uid) || 0) + Number(p.amount));
    countByUser.set(uid, (countByUser.get(uid) || 0) + 1);
    creditedTotal += Number(p.amount);
  }

  const board = users
    .map(u => ({
      userId: u.id, name: u.name,
      calls: callsByUser.get(u.id) || 0,
      collected: collectedByUser.get(u.id) || 0,
      paymentsProcessed: countByUser.get(u.id) || 0,
      mapped: !!u.frEmployeeId, // false = can't be credited yet (no FR mapping)
    }))
    .filter(r => r.calls > 0 || r.collected > 0)
    .sort((a, b) => b.collected - a.collected || b.calls - a.calls);

  return NextResponse.json({
    view: 'leaderboard', range,
    creditedTotal, selfServeTotal,
    unmappedUsers: users.filter(u => !u.frEmployeeId).map(u => u.name),
    board,
  });
}
