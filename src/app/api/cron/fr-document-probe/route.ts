// READ-ONLY probe: discover whether FieldRoutes exposes a documents/files endpoint, and fetch them for a
// given customer. Tries several likely entity names and reports which respond.
//   /api/cron/fr-document-probe?token=critterstop2026&office=DFW&cust=12353
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const cust = sp.get('cust');
  const cfg = OFFICES[office];
  if (!cfg?.key || !cust) return NextResponse.json({ error: 'need office + cust' }, { status: 400 });

  // Documents can be attached to the customer, an appointment, or a ticket. Try all the filters FR supports.
  const apptIds = sp.get('appts') || ''; // comma list
  const ticketIds = sp.get('tickets') || '';
  const filters: Record<string, string> = { customerIDs: cust };
  if (apptIds) filters.appointmentIDs = apptIds;
  if (ticketIds) filters.ticketIDs = ticketIds;

  const searchVariants: any[] = [];
  // a) by customer
  searchVariants.push({ by: 'customerIDs', ...(await docSearch({ customerIDs: cust }, cfg.key, cfg.token)) });
  // b) by appointment
  if (apptIds) searchVariants.push({ by: 'appointmentIDs', ...(await docSearch({ appointmentIDs: apptIds }, cfg.key, cfg.token)) });
  // c) by ticket
  if (ticketIds) searchVariants.push({ by: 'ticketIDs', ...(await docSearch({ ticketIDs: ticketIds }, cfg.key, cfg.token)) });
  // d) unfiltered-ish: some FR search endpoints need at least one filter; try a broad recent search by customer only already done.

  // Collect any document IDs found across variants.
  const allIds = [...new Set(searchVariants.flatMap(v => v.documentIDs || []))];
  let docs: any[] = [];
  if (allIds.length) {
    const idParam = allIds.length === 1 ? `${allIds[0]},${allIds[0]}` : allIds.join(',');
    const getUrl = `${FR_BASE}/document/get?documentIDs=${idParam}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const getBody: any = await fetch(getUrl).then(r => r.json()).catch(() => ({}));
    docs = getBody.documents || [];
  }

  return NextResponse.json({
    office, cust, searchVariants,
    totalDocIds: allIds.length, documentIDs: allIds,
    documents: docs.map((d: any) => ({ ...d, _allKeys: Object.keys(d) })),
    rawFirstDoc: docs[0] ? JSON.stringify(docs[0]).substring(0, 800) : null,
  });
}

async function docSearch(params: Record<string, string>, key: string, token: string) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const url = `${FR_BASE}/document/search?${qs}&authenticationKey=${key}&authenticationToken=${token}`;
  const body: any = await fetch(url).then(r => r.json()).catch(() => ({}));
  return { count: body.count ?? (body.documentIDs || []).length, documentIDs: body.documentIDs || [], success: body.success, error: body.errorMessage || null };
}
