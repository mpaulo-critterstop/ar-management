// Detect invoices DELETED in FieldRoutes that the Hub still thinks are live.
// Root cause this fixes: the invoice sync only upserts tickets FR RETURNS for a date range. A ticket deleted
// in FR simply disappears from FR's responses, so the normal sync never sees it to remove it — it lingers in
// the Hub, keeps showing as overdue, and (critically) keeps driving PestAI/AR outreach to the customer.
//
// This sweep takes the Hub's still-active invoices (CURRENT/OVERDUE/COLLECTIONS/PAYMENT_PLAN/DISPUTED) and
// verifies each against FR via ticket/get. If FR returns 0 tickets for that id, the ticket was deleted →
// we mark the Hub invoice VOID_DELETED so it drops out of AR, the collections tracker, and outreach.
//
//   /api/cron/detect-deleted-invoices?token=critterstop2026&office=DFW
//   &dry=1                 → preview (no writes)
//   &invoice=267035        → check a single invoice id (immediate targeted fix)
//   &max=500               → cap how many to check this run (default 400; respects FR 60/min read limit)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICE_CREDS: Record<string, { key: string; token: string }> = {
  DFW: {
    key: '6t0i20austp8ts2ln5296vi45qifgjrh08bbpfp1svijke8enjpr8d55qo81nsml',
    token: 'uinj35806p728f9bktr984gsml74a8to077g6ufpjcvlk7v5g0bgqe256l2nn5gb',
  },
};

async function frTicketExists(office: string, ticketId: string): Promise<boolean | null> {
  const creds = OFFICE_CREDS[office];
  if (!creds) return null;
  const auth = `authenticationKey=${creds.key}&authenticationToken=${creds.token}`;
  // FR single-id quirk: duplicate the id.
  const url = `${FR_BASE}/ticket/get?${auth}&ticketIDs=${ticketId},${ticketId}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (j.success !== true) return null; // inconclusive — don't void on an API error
    // FR returns success:true with tickets:[] for a deleted/nonexistent ticket.
    return Array.isArray(j.tickets) && j.tickets.length > 0;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026' && sp.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const office = sp.get('office') || 'DFW';
  const dry = sp.get('dry') === '1';
  const single = sp.get('invoice');
  const max = Math.min(parseInt(sp.get('max') || '400', 10), 2000);
  const now = new Date();

  // Build the candidate set: still-"live" invoices in the Hub (these are the ones that matter — a deleted
  // one lingering here is what drives bad outreach). Skip already-PAID/VOID. For the targeted single check,
  // just that one.
  const where: any = single
    ? { externalId: String(single), office }
    : { office, status: { in: ['CURRENT', 'OVERDUE', 'COLLECTIONS', 'PAYMENT_PLAN', 'DISPUTED'] as any }, arReopened: false };

  const invoices = await prisma.invoice.findMany({
    where,
    select: { id: true, externalId: true, status: true, customer: { select: { name: true } } },
    orderBy: { updatedAt: 'asc' }, // check stalest first
    take: single ? 5 : max,
  });

  const checked: any[] = [];
  let voided = 0, stillValid = 0, inconclusive = 0;

  for (const inv of invoices) {
    if (!inv.externalId) continue;
    const exists = await frTicketExists(office, inv.externalId);
    if (exists === null) { inconclusive++; continue; }
    if (exists) { stillValid++; continue; }

    // FR confirms deleted → void it in the Hub.
    voided++;
    checked.push({ invoice: inv.externalId, customer: inv.customer?.name, was: inv.status, action: dry ? 'WOULD_VOID' : 'VOIDED' });
    if (!dry) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { status: 'VOID_DELETED' as any, amount: 0, paid: 0 },
      });
      // Pull it out of the collections tracker if present.
      await prisma.collectionsTracker.updateMany({
        where: { invoiceId: inv.id, stage: { notIn: ['PAID', 'REMOVED', 'BAD_DEBT_APPROVED'] } },
        data: { stage: 'REMOVED', notes: `Auto-removed ${now.toISOString().slice(0, 10)}: ticket deleted in FieldRoutes` },
      }).catch(() => {});
    }
  }

  if (!dry && !single) {
    await prisma.appSetting.upsert({
      where: { key: 'detect_deleted_status' },
      create: { key: 'detect_deleted_status', value: `${now.toISOString()} :: checked ${invoices.length}, voided ${voided}, inconclusive ${inconclusive}` },
      update: { value: `${now.toISOString()} :: checked ${invoices.length}, voided ${voided}, inconclusive ${inconclusive}` },
    }).catch(() => {});
  }

  return NextResponse.json({
    office, dry, single: single || null,
    checkedCount: invoices.length, voided, stillValid, inconclusive,
    note: voided > 0 && !dry ? 'Voided invoices are now VOID_DELETED — excluded from AR, collections, and outreach.' : undefined,
    detail: checked.slice(0, 200),
  });
}
