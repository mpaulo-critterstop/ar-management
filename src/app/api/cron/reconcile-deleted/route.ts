// Deleted-invoice reconciliation sweep.
// Finds Hub invoices whose FieldRoutes ticket no longer exists (deleted in FR) and voids them
// (zero balance, off the blitz — NOT hard-deleted, payments preserved).
//
//   DRY RUN (default, changes nothing):
//     /api/cron/reconcile-deleted?office=CStat&token=critterstop2026
//   APPLY (actually voids):
//     /api/cron/reconcile-deleted?office=CStat&token=critterstop2026&apply=1
//
// Scope options:
//   &office=CStat|DFW|ATX|OKC|All   (default All)
//   &overdueOnly=1                  (only check overdue/unpaid — fewer FR calls, targets what matters)
//   &limit=2000                     (cap invoices checked this run, for safety)
//
// SAFETY: an invoice is only flagged phantom if FR's ticket/search (queried WITH its explicit ticketID)
// does NOT return it. That's definitive, not a fuzzy date miss. Dry-run reports first; apply is explicit.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const maxDuration = 800;

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};
const BATCH = 200; // ticketIDs per ticket/search call

async function frSearchExisting(ticketIds: string[], key: string, token: string): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < ticketIds.length; i += BATCH) {
    const chunk = ticketIds.slice(i, i + BATCH);
    const url = `${FR_BASE}/ticket/search?ticketIDs=${chunk.join(',')}&authenticationKey=${key}&authenticationToken=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data?.success) {
      // If FR errors on a batch, treat ALL as existing (fail-safe: never void on an API failure).
      chunk.forEach(id => existing.add(String(id)));
      continue;
    }
    (data.ticketIDs || []).forEach((id: number) => existing.add(String(id)));
    // gentle pacing for the 60/min read cap
    await new Promise(r => setTimeout(r, 150));
  }
  return existing;
}

async function sweepOffice(office: string, apply: boolean, overdueOnly: boolean, limit: number) {
  const cfg = OFFICES[office];
  if (!cfg?.key) return { office, error: 'unconfigured' };

  const invoices = await prisma.invoice.findMany({
    where: {
      office,
      externalId: { not: null },
      ...(overdueOnly ? { due: { not: null, lt: new Date() } } : {}),
    },
    select: { id: true, externalId: true, amount: true, paid: true, status: true, due: true, blitzListedAt: true },
    take: limit,
  });
  // If overdueOnly, keep just unpaid ones (paid < amount) — done in JS to avoid field-ref pitfalls.
  const scoped = overdueOnly ? invoices.filter(i => Number(i.paid) < Number(i.amount)) : invoices;
  if (scoped.length === 0) return { office, checked: 0, phantoms: 0, voided: 0, examples: [] };

  const ids = scoped.map(i => String(i.externalId));
  const existing = await frSearchExisting(ids, cfg.key, cfg.token);

  // Phantom = in Hub but NOT returned by FR ticket/search.
  const phantoms = scoped.filter(inv => !existing.has(String(inv.externalId)));

  let voided = 0;
  if (apply && phantoms.length > 0) {
    for (const p of phantoms) {
      const paidAmt = Number(p.paid) || 0;
      await prisma.invoice.update({
        where: { id: p.id },
        data: {
          status: 'PAID', amount: paidAmt, paid: paidAmt, due: null,
          blitzListedAt: null, blitzAssignedTo: null,
          arNote: `[voided ${new Date().toISOString().slice(0,10)}: FR ticket deleted]`,
        },
      });
      voided++;
    }
  }

  return {
    office,
    checked: scoped.length,
    phantoms: phantoms.length,
    voided,
    outstandingRemoved: phantoms.reduce((s, p) => s + (Number(p.amount) - Number(p.paid)), 0),
    examples: phantoms.slice(0, 20).map(p => ({
      externalId: p.externalId, status: p.status,
      outstanding: Number(p.amount) - Number(p.paid), due: p.due,
      onBlitz: !!p.blitzListedAt,
    })),
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apply = sp.get('apply') === '1';
  const overdueOnly = sp.get('overdueOnly') === '1';
  const limit = Math.min(Number(sp.get('limit')) || 5000, 10000);
  const officeParam = sp.get('office') || 'All';
  const offices = (officeParam === 'All') ? Object.keys(OFFICES) : [officeParam];

  const results = [];
  for (const office of offices) {
    results.push(await sweepOffice(office, apply, overdueOnly, limit));
  }

  return NextResponse.json({
    mode: apply ? 'APPLIED (voided phantoms)' : 'DRY RUN (no changes)',
    overdueOnly, limit,
    totals: {
      checked: results.reduce((s, r: any) => s + (r.checked || 0), 0),
      phantoms: results.reduce((s, r: any) => s + (r.phantoms || 0), 0),
      voided: results.reduce((s, r: any) => s + (r.voided || 0), 0),
      outstandingRemoved: results.reduce((s, r: any) => s + (r.outstandingRemoved || 0), 0),
    },
    byOffice: results,
  });
}
