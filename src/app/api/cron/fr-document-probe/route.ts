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

  // 1) Search this customer's documents.
  const searchUrl = `${FR_BASE}/document/search?customerIDs=${cust}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  const searchRes = await fetch(searchUrl);
  const searchBody: any = await searchRes.json().catch(() => ({}));
  const docIds: any[] = searchBody.documentIDs || [];

  // 2) Get the document details (metadata). Pad single id (FR quirk).
  let docs: any[] = [];
  if (docIds.length) {
    const idParam = docIds.length === 1 ? `${docIds[0]},${docIds[0]}` : docIds.join(',');
    const getUrl = `${FR_BASE}/document/get?documentIDs=${idParam}&authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const getRes = await fetch(getUrl);
    const getBody: any = await getRes.json().catch(() => ({}));
    docs = getBody.documents || [];
  }

  return NextResponse.json({
    office, cust,
    count: searchBody.count ?? docIds.length,
    documentIDs: docIds,
    documents: docs.map((d: any) => ({
      documentID: d.documentID, description: d.description, fileName: d.fileName || d.filename,
      contentType: d.contentType, dateAdded: d.dateAdded, uploadedBy: d.uploadedBy,
      // show any URL-ish or content field so we learn how to retrieve the actual file
      _allKeys: Object.keys(d),
    })),
    rawFirstDoc: docs[0] ? JSON.stringify(docs[0]).substring(0, 600) : null,
  });
}

// (old multi-entity discovery probe kept below for reference but no longer reached)
