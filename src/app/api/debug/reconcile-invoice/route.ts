// Reconcile one (or all stale) invoice(s) against FR's CURRENT ticket balance — fixes paid-but-still-due
// invoices whose FR dateUpdated fell outside the incremental sync's rolling window.
//   /api/debug/reconcile-invoice?token=critterstop2026&office=CStat&ticket=255864   (one ticket)
//   /api/debug/reconcile-invoice?token=critterstop2026&office=CStat&dry=1&sweep=1     (find ALL stale-paid, preview)
//   /api/debug/reconcile-invoice?token=critterstop2026&office=CStat&sweep=1           (fix ALL stale-paid)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

let frChain: Promise<any> = Promise.resolve();
function frFetch(url: string): Promise<any> {
  const run = frChain.then(async () => { await new Promise(r => setTimeout(r, 350)); const r = await fetch(url); return r.json(); });
  frChain = run.catch(() => {});
  return run;
}
async function getTickets(ids: string[], key: string, token: string): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const idParam = chunk.length === 1 ? `${chunk[0]},${chunk[0]}` : chunk.join(',');
    const data = await frFetch(`${BASE_URL}/ticket/get?ticketIDs=${idParam}&authenticationKey=${key}&authenticationToken=${token}`);
    if (Array.isArray(data.tickets)) out.push(...data.tickets);
  }
  return out;
}

function statusFor(balance: number, due: Date | null): string {
  if (balance <= 0) return 'PAID';
  if (due && due < new Date()) return 'OVERDUE';
  return 'CURRENT';
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office');
  const ticket = sp.get('ticket');
  const dry = sp.get('dry') === '1';
  const sweep = sp.get('sweep') === '1';
  if (!office || !OFFICES[office]?.key) return NextResponse.json({ error: 'need valid office' }, { status: 400 });
  const cfg = OFFICES[office];

  // Which invoices to reconcile: one ticket, or ALL that the Hub thinks are not-yet-paid (sweep).
  let targetExternalIds: string[];
  if (ticket) {
    targetExternalIds = [ticket];
  } else if (sweep) {
    const openInvoices = await prisma.invoice.findMany({
      where: { office, status: { in: ['OVERDUE', 'CURRENT'] } },
      select: { externalId: true },
    });
    targetExternalIds = openInvoices.map(i => i.externalId).filter(Boolean) as string[];
  } else {
    return NextResponse.json({ error: 'need ticket= or sweep=1' }, { status: 400 });
  }

  const tickets = await getTickets(targetExternalIds, cfg.key, cfg.token);
  const byId = new Map(tickets.map(t => [String(t.ticketID), t]));

  const changes: any[] = [];
  for (const extId of targetExternalIds) {
    const t = byId.get(String(extId));
    if (!t) continue;
    const amount = parseFloat(t.total);
    const balance = parseFloat(t.balance);
    const paid = Math.max(0, amount - balance);
    const inv = await prisma.invoice.findFirst({ where: { externalId: String(extId) }, select: { id: true, paid: true, status: true, due: true, arReopened: true } });
    if (!inv) continue;
    if (inv.arReopened) continue; // don't touch admin-reopened invoices
    const newStatus = statusFor(balance, inv.due);
    // Only act when the Hub is out of sync (paid amount or status differs).
    if (Math.abs(Number(inv.paid) - paid) > 0.005 || inv.status !== newStatus) {
      changes.push({ externalId: extId, oldPaid: Number(inv.paid), newPaid: paid, oldStatus: inv.status, newStatus, amount });
      if (!dry) {
        await prisma.invoice.update({ where: { id: inv.id }, data: { paid, status: newStatus as any } });
      }
    }
  }

  return NextResponse.json({ ok: true, dry, office, checked: targetExternalIds.length, ticketsFound: tickets.length, changed: changes.length, changes: changes.slice(0, 200) });
}
