// Google LSA lead sync — pulls Local Services leads + conversations from the Google Ads API and upserts
// into lsa_leads. Preserves our follow-up `status` (never overwrites it after first insert).
//
//   /api/cron/lsa-sync?token=critterstop2026            (default: last 90 days)
//   &days=180   widen window
//
// Auth: refresh_token -> access_token via Google OAuth. Requires these Vercel env vars:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_LSA_CUSTOMER_ID
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deriveLsaStage, normalizePhone } from '@/lib/lsaStage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const API_VERSION = 'v22';
const clean = (id: string | undefined) => (id || '').replace(/-/g, ''); // customer IDs: no dashes in API

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`OAuth token refresh failed: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function gaql(accessToken: string, customerId: string, query: string): Promise<any[]> {
  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
        'login-customer-id': clean(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`GAQL error ${res.status}: ${text.slice(0, 500)}`);
  // searchStream returns a JSON array of {results: [...]} chunks
  const chunks = JSON.parse(text);
  const rows: any[] = [];
  for (const c of chunks) for (const r of (c.results || [])) rows.push(r);
  return rows;
}

const LEAD_TYPE: Record<number, string> = { 0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'MESSAGE', 3: 'PHONE_CALL', 4: 'BOOKING' };
const LEAD_STATUS: Record<number, string> = {
  0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'NEW', 3: 'ACTIVE', 4: 'BOOKED', 5: 'DECLINED',
  6: 'EXPIRED', 7: 'DISABLED', 8: 'CONSUMER_DECLINED', 9: 'WIPED_OUT',
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Preflight: surface a clear message if any required env var is missing (esp. the client secret).
  const required = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'GOOGLE_ADS_LSA_CUSTOMER_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) return NextResponse.json({ error: 'Missing env vars', missing }, { status: 400 });

  const days = Math.min(Number(sp.get('days')) || 90, 730);
  const customerId = clean(process.env.GOOGLE_ADS_LSA_CUSTOMER_ID);

  try {
    const accessToken = await getAccessToken();

    // Google only supports certain predefined literals with DURING (LAST_30_DAYS etc.) — LAST_90_DAYS is
    // NOT one of them. Use an explicit start date so any window (incl. 90+) works.
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD

    // 1) Leads
    const leadRows = await gaql(accessToken, customerId, `
      SELECT local_services_lead.id, local_services_lead.lead_type,
             local_services_lead.category_id, local_services_lead.service_id,
             local_services_lead.lead_status, local_services_lead.contact_details,
             local_services_lead.creation_date_time, local_services_lead.lead_charged,
             local_services_lead.note.description
      FROM local_services_lead
      WHERE local_services_lead.creation_date_time >= '${startDate} 00:00:00'
      ORDER BY local_services_lead.creation_date_time DESC
    `.replace(/\s+/g, ' ').trim());

    // 2) Conversations (message text / call info) keyed by lead
    const convRows = await gaql(accessToken, customerId, `
      SELECT local_services_lead_conversation.id,
             local_services_lead_conversation.lead,
             local_services_lead_conversation.participant_type,
             local_services_lead_conversation.conversation_channel,
             local_services_lead_conversation.event_date_time,
             local_services_lead_conversation.message_details.text,
             local_services_lead_conversation.phone_call_details.call_duration_millis
      FROM local_services_lead_conversation
      ORDER BY local_services_lead_conversation.event_date_time DESC
    `.replace(/\s+/g, ' ').trim());

    // index conversations by lead resource name
    const convByLead = new Map<string, any[]>();
    for (const r of convRows) {
      const conv = r.localServicesLeadConversation || {};
      const leadRes = conv.lead; // resource name: customers/X/localServicesLeads/ID
      if (!leadRes) continue;
      if (!convByLead.has(leadRes)) convByLead.set(leadRes, []);
      convByLead.get(leadRes)!.push(conv);
    }

    // Build a phone -> "has booked appointment" set for the Booked cross-reference. A customer counts as
    // "booked" if their phone matches AND they have at least one Lead (wildlife inspection = an FR
    // appointment) OR an Invoice (actual job). Normalized to last-10-digits.
    const bookedPhones = new Set<string>();
    const custs = await prisma.customer.findMany({
      where: { phone: { not: null } },
      select: { phone: true, _count: { select: { leads: true } } },
    }).catch(() => [] as any[]);
    for (const c of custs) {
      const p = normalizePhone(c.phone);
      if (p && (c as any)._count?.leads > 0) bookedPhones.add(p);
    }

    let upserted = 0, autoBooked = 0;
    for (const r of leadRows) {
      const L = r.localServicesLead || {};
      const leadId = String(L.id);
      const leadRes = `customers/${customerId}/localServicesLeads/${leadId}`;
      const convs = convByLead.get(leadRes) || [];
      // latest activity + latest message text + who sent the latest event (for stage derivation)
      let lastActivityAt: Date | null = null;
      let lastMessageText: string | null = null;
      let lastParticipant: string | null = null;
      for (const c of convs) {
        const t = c.eventDateTime ? new Date(c.eventDateTime.replace(' ', 'T')) : null;
        if (t && (!lastActivityAt || t > lastActivityAt)) {
          lastActivityAt = t;
          lastMessageText = c.messageDetails?.text || null;
          lastParticipant = c.participantType || null; // 'ADVERTISER' | 'CONSUMER'
        }
      }
      const contact = L.contactDetails || {};
      const leadType = LEAD_TYPE[L.leadType] || String(L.leadType || 'UNKNOWN');
      const gStatus = LEAD_STATUS[L.leadStatus] || String(L.leadStatus || '');
      const creation = L.creationDateTime ? new Date(L.creationDateTime.replace(' ', 'T')) : null;
      const phone = contact.phoneNumber || null;

      // Cross-reference Booked: LSA phone matches a customer with a booked appointment (Lead), OR Google
      // itself says BOOKED.
      const normPhone = normalizePhone(phone);
      const isBooked = gStatus === 'BOOKED' || (normPhone ? bookedPhones.has(normPhone) : false);

      // Auto-derive the follow-up stage from conversation activity.
      const derived = deriveLsaStage({ lastParticipant: lastParticipant as any, lastActivityAt, creationDateTime: creation });
      const autoStage = isBooked ? 'Booked' : derived;

      const existing = await prisma.lsaLead.findUnique({ where: { leadId }, select: { manualOverride: true, status: true } });

      // Respect manual overrides: if a human hand-set the stage, don't auto-change it (except we still
      // let auto-Booked win, since a confirmed booking is authoritative). Otherwise use the derived stage.
      let statusToSet: string = autoStage;
      if (existing?.manualOverride && !isBooked) statusToSet = existing.status;
      if (isBooked && !existing?.status?.includes('Lost')) statusToSet = 'Booked';
      if (isBooked) autoBooked++;

      await prisma.lsaLead.upsert({
        where: { leadId },
        create: {
          leadId, leadType, category: L.categoryId ? String(L.categoryId) : null,
          serviceId: L.serviceId ? String(L.serviceId) : null,
          status: statusToSet, googleLeadStatus: gStatus,
          contactName: contact.consumerName || null, contactPhone: phone,
          leadCharged: L.leadCharged ?? null, note: L.note?.description || null,
          creationDateTime: creation, lastActivityAt, lastParticipant,
          lastMessageText, conversationCount: convs.length,
        },
        update: {
          leadType, googleLeadStatus: gStatus,
          contactName: contact.consumerName || null, contactPhone: phone,
          leadCharged: L.leadCharged ?? null, note: L.note?.description || null,
          lastActivityAt, lastParticipant, lastMessageText, conversationCount: convs.length,
          status: statusToSet,
        },
      });
      upserted++;
    }

    return NextResponse.json({ ok: true, days, leads: leadRows.length, conversations: convRows.length, upserted, autoBooked });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
