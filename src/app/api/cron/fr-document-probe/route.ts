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
  // a) by customer — NOTE: this endpoint uses customerID (singular), not customerIDs
  searchVariants.push({ by: 'customerID', ...(await docSearch({ customerID: cust }, cfg.key, cfg.token)) });
  // b) by appointment
  if (apptIds) searchVariants.push({ by: 'appointmentIDs', ...(await docSearch({ appointmentIDs: apptIds }, cfg.key, cfg.token)) });
  // c) by ticket
  if (ticketIds) searchVariants.push({ by: 'ticketIDs', ...(await docSearch({ ticketIDs: ticketIds }, cfg.key, cfg.token)) });

  // Collect any document IDs found across variants.
  const allIds = [...new Set(searchVariants.flatMap(v => v.documentIDs || []))];
  let docs: any[] = [];
  if (allIds.length) {
    // get endpoint takes uploadIDs (not documentIDs). Pad single id.
    const idParam = allIds.length === 1 ? `${allIds[0]},${allIds[0]}` : allIds.join(',');
    const getUrl = `${FR_BASE}/document/get?uploadIDs=${idParam}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const getBody: any = await fetch(getUrl).then(r => r.json()).catch(() => ({}));
    docs = getBody.documents || [];
  }

  // Also probe for a FORMS endpoint — the Trap Check / Close-Out CHECKLISTS live in FR's Forms/eSign system,
  // not the document endpoint. Try likely entity names to discover if any is API-accessible.
  const formEntities = ['form', 'forms', 'formData', 'customerForm', 'eSignature', 'esign', 'signature', 'checklist', 'formSubmission', 'appointmentForm'];
  const formProbe: any[] = [];
  for (const ent of formEntities) {
    const url = `${FR_BASE}/${ent}/search?customerID=${cust}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const body: any = await fetch(url).then(r => r.json()).catch(() => ({ _fetchError: true }));
    formProbe.push({ entity: ent, success: body.success, error: body.errorMessage || null, idName: body.idName || null, count: body.count ?? null, keys: body && typeof body === 'object' ? Object.keys(body).filter(k => !['params','authenticationKey','authenticationToken'].includes(k)).slice(0, 8) : null });
  }

  // The `form` endpoint works and returns contractIDs — this is where the Trap Check / Close-Out CHECKLISTS
  // live. Search then get the form details.
  const formSearchUrl = `${FR_BASE}/form/search?customerID=${cust}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  const formSearchBody: any = await fetch(formSearchUrl).then(r => r.json()).catch(() => ({}));
  const contractIds: any[] = formSearchBody.contractIDs || formSearchBody.formIDs || [];
  let forms: any[] = [];
  if (contractIds.length) {
    const idParam = contractIds.length === 1 ? `${contractIds[0]},${contractIds[0]}` : contractIds.join(',');
    const formGetUrl = `${FR_BASE}/form/get?contractIDs=${idParam}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const formGetBody: any = await fetch(formGetUrl).then(r => r.json()).catch(() => ({}));
    forms = formGetBody.forms || formGetBody.contracts || formGetBody.documents || [];
  }

  return NextResponse.json({
    office, cust, searchVariants,
    totalDocIds: allIds.length, documentIDs: allIds,
    documents: docs.map((d: any) => ({ ...d, _allKeys: Object.keys(d) })),
    formCount: formSearchBody.count ?? contractIds.length,
    contractIDs: contractIds,
    forms: forms.map((f: any) => ({ ...f, _allKeys: Object.keys(f) })),
    rawFirstForm: forms[0] ? JSON.stringify(forms[0]).substring(0, 1000) : null,
    formGetPropertyName: formSearchBody.propertyName,
  });
}

async function docSearch(params: Record<string, string>, key: string, token: string) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const url = `${FR_BASE}/document/search?${qs}&authenticationKey=${key}&authenticationToken=${token}`;
  const body: any = await fetch(url).then(r => r.json()).catch(() => ({}));
  // NOTE: the document endpoint returns IDs under `documentIDs` but the get endpoint takes `uploadIDs`.
  return { count: body.count ?? (body.documentIDs || []).length, documentIDs: body.documentIDs || [], idName: body.idName, success: body.success, error: body.errorMessage || null };
}
