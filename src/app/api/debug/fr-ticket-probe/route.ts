// Probe one FR ticket + its customer's payments, to diagnose paid-but-still-due invoices.
//   /api/debug/fr-ticket-probe?token=critterstop2026&office=CStat&ticket=255864
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

async function fr(endpoint: string, action: string, params: string, key: string, token: string) {
  const url = `${BASE_URL}/${endpoint}/${action}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const r = await fetch(url);
  return r.json();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'CStat';
  const ticket = sp.get('ticket');
  const cfg = OFFICES[office];
  if (!cfg?.key || !ticket) return NextResponse.json({ error: 'need office + ticket' }, { status: 400 });

  // 1) The ticket itself — total, balance, customer.
  const tg = await fr('ticket', 'get', `ticketIDs=${ticket},${ticket}`, cfg.key, cfg.token);
  const t = (tg.tickets || [])[0] || null;
  const customerID = t?.customerID;

  // 2) The customer's payments (to see if a payment exists and how it was applied).
  let payments: any[] = [];
  if (customerID) {
    const ps = await fr('payment', 'search', `customerID=${customerID}`, cfg.key, cfg.token);
    const payIds: any[] = ps.paymentIDs || [];
    if (payIds.length) {
      const idParam = payIds.length === 1 ? `${payIds[0]},${payIds[0]}` : payIds.slice(0, 50).join(',');
      const pg = await fr('payment', 'get', `paymentIDs=${idParam}`, cfg.key, cfg.token);
      payments = (pg.payments || []).map((p: any) => ({
        paymentID: p.paymentID, amount: p.amount, date: p.date, dateUpdated: p.dateUpdated,
        appliedTicketID: p.ticketID || p.appliedTicketID, status: p.status, paymentMethod: p.paymentMethod,
      }));
    }
  }

  return NextResponse.json({
    office, ticket, customerID,
    ticketRaw: t ? {
      ticketID: t.ticketID, total: t.total, balance: t.balance, invoiceDate: t.invoiceDate,
      dateUpdated: t.dateUpdated, dateCompleted: t.dateCompleted, active: t.active, subscriptionID: t.subscriptionID,
    } : null,
    payments,
  });
}
