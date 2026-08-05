// AR daily call sheet.
// GET  /api/ar/call-sheet[?office=DFW]  -> invoices due for a call today (past cadence step, not yet
//      called in the current window), with customer/invoice details + previous notes. Uncalled items
//      roll over automatically (they simply keep matching until actioned or paid).
// POST /api/ar/call-sheet  { invoiceId, customerId, text, status?, promisedAmount?, promisedDate? }
//      -> logs a CollectionNote (marks called); drops it off the list until the next cadence step.
//
// Cadence (days past DUE date): first call at 21, then 28, then every 4 days (32, 36, 40, ...).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';

// Return the most recent cadence-step threshold (in days overdue) at or below `daysOverdue`,
// and the previous step, so we can define the "current window" for the call.
function cadenceWindow(daysOverdue: number): { currentStep: number | null; windowStart: number } {
  if (daysOverdue < 21) return { currentStep: null, windowStart: 0 };
  if (daysOverdue < 28) return { currentStep: 21, windowStart: 21 };
  // 28, then every 4 days: 28, 32, 36, ...
  const stepsAfter28 = Math.floor((daysOverdue - 28) / 4);
  const currentStep = 28 + stepsAfter28 * 4;
  return { currentStep, windowStart: currentStep };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'ar')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const office = req.nextUrl.searchParams.get('office');
  const now = new Date();
  const noFilter = !office || office === 'All' || office === 'ALL' || office === 'all';
  const officeFilter = !noFilter ? `AND i.office = '${office!.replace(/'/g, "''")}'` : '';

  // Overdue, unpaid invoices (past due date), not excluded from automation.
  const invoices = await prisma.$queryRawUnsafe(`
    SELECT i.id, i."customerId", i.date, i.due, i.amount, i.paid, i."serviceType", i."serviceId", i."arNote", i.office,
           c.name as "customerName", c.phone, c.email, c."serviceAddr"
    FROM invoices i
    JOIN customers c ON c.id = i."customerId"
    WHERE i.due IS NOT NULL
      AND i.due < NOW()
      AND i.paid < i.amount
      AND i.amount > 0
      AND c."excludeFromAutomation" = false
      AND i."arStage" IS NULL
      ${officeFilter}
    ORDER BY i.due ASC
  `) as any[];

  if (!invoices.length) return NextResponse.json({ date: now.toISOString().slice(0, 10), count: 0, items: [] });

  // Pull recent collection notes for these invoices to decide "already called this window".
  const invoiceIds = invoices.map(i => i.id);
  const notes = await prisma.collectionNote.findMany({
    where: { invoiceId: { in: invoiceIds } },
    orderBy: { date: 'desc' },
    select: { invoiceId: true, date: true, text: true, status: true, promisedDate: true, promisedAmount: true },
  });
  const notesByInvoice = new Map<string, any[]>();
  for (const n of notes) {
    if (!n.invoiceId) continue;
    (notesByInvoice.get(n.invoiceId) || notesByInvoice.set(n.invoiceId, []).get(n.invoiceId)!).push(n);
  }

  const MS_DAY = 86400000;
  const items = [];
  for (const inv of invoices) {
    const due = new Date(inv.due);
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / MS_DAY);
    const { currentStep, windowStart } = cadenceWindow(daysOverdue);
    if (currentStep == null) continue; // not yet at the 21-day first-call threshold

    // "Called this window" = a note exists dated at/after the day this window opened.
    const windowOpenedDate = new Date(due.getTime() + windowStart * MS_DAY);
    const invNotes = notesByInvoice.get(inv.id) || [];
    const calledThisWindow = invNotes.some(n => new Date(n.date) >= windowOpenedDate);
    if (calledThisWindow) continue; // actioned already this step → rolls to next step

    const outstanding = Number(inv.amount) - Number(inv.paid);
    // "Entered the sheet" = the day it crossed 21 days overdue (first cadence step).
    const enteredSheet = new Date(due.getTime() + 21 * MS_DAY);
    const daysOnSheet = Math.floor((now.getTime() - enteredSheet.getTime()) / MS_DAY);
    const lastNote = invNotes[0] || null;
    const daysSinceCall = lastNote ? Math.floor((now.getTime() - new Date(lastNote.date).getTime()) / MS_DAY) : null;
    const WILDLIFE_IDS = [553, 716, 720, 501, 674, 479, 541, 542, 624, 510];
    const isWildlife = WILDLIFE_IDS.includes(Number(inv.serviceId));

    items.push({
      invoiceId: inv.id,
      customerId: inv.customerId,
      customerName: inv.customerName,
      phone: inv.phone,
      email: inv.email,
      serviceAddr: inv.serviceAddr,
      serviceType: inv.serviceType,
      serviceCategory: isWildlife ? 'Wildlife' : 'Pest Control',
      office: inv.office,
      amount: Number(inv.amount),
      outstanding,
      due: inv.due,
      daysOverdue,
      cadenceStep: currentStep,
      enteredSheet: enteredSheet.toISOString().slice(0, 10),
      daysOnSheet,
      daysSinceCall,
      arNote: inv.arNote || '',
      lastNote: lastNote ? { text: lastNote.text, date: lastNote.date, status: lastNote.status } : null,
      noteCount: invNotes.length,
    });
  }

  // Most overdue first.
  items.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return NextResponse.json({ date: now.toISOString().slice(0, 10), count: items.length, items });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'ar')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const { invoiceId, customerId, text, status, promisedAmount, promisedDate } = b;
  if (!customerId || !text) {
    return NextResponse.json({ error: 'customerId and text (note) are required' }, { status: 400 });
  }

  const note = await prisma.collectionNote.create({
    data: {
      customerId,
      invoiceId: invoiceId || null,
      userId: (session.user as any).id || null,
      text,
      status: status || 'NO_CONTACT',
      promisedAmount: promisedAmount != null ? promisedAmount : null,
      promisedDate: promisedDate ? new Date(promisedDate) : null,
    },
  });
  return NextResponse.json({ ok: true, note });
}

// PATCH: save the persistent note (arNote) and/or set the escalation stage (arStage).
// { invoiceId, arNote?, arStage? }  arStage: 'COLLECTIONS'|'SCC'|'BAD_DEBT'|null (null = back to call sheet)
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'ar')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const { invoiceId, arNote, arStage } = b;
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });

  const data: any = {};
  if (arNote !== undefined) data.arNote = arNote ?? null;
  if (arStage !== undefined) {
    const valid = ['COLLECTIONS', 'SCC', 'BAD_DEBT', null];
    if (!valid.includes(arStage)) return NextResponse.json({ error: 'invalid arStage' }, { status: 400 });
    data.arStage = arStage;
    data.arStageAt = arStage ? new Date() : null;
  }
  await prisma.invoice.update({ where: { id: invoiceId }, data });
  return NextResponse.json({ ok: true });
}
