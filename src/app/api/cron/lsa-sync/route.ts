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
import { deriveLsaStage, normalizePhone, isBusinessHoursCentral } from '@/lib/lsaStage';
import { waitUntil } from '@vercel/functions';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function postSlack(text: string, silent = false): Promise<boolean> {
  if (silent) return true; // silent mode: pretend success so dedupe flags still get set, but send nothing
  const url = process.env.SLACK_LSA_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    return res.ok;
  } catch { return false; }
}

const API_VERSION = 'v22';
const clean = (id: string | undefined) => (id || '').replace(/-/g, ''); // customer IDs: no dashes in API

// Google Ads returns lead/conversation timestamps as 'YYYY-MM-DD HH:MM:SS' in the ACCOUNT's local timezone
// (US Central for these), with NO offset. new Date() on a UTC server would misread them as UTC — a ~5-6h
// error that made brand-new leads look hours old. Parse them explicitly as America/Chicago.
function parseCentral(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
  const [, y, mo, d, h, mi, se] = m.map(Number) as any;
  // Determine the Central offset (CDT -05:00 / CST -06:00) for this date by probing the zone.
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' })
    .formatToParts(probe).find(p => p.type === 'timeZoneName')?.value || 'CST';
  const offsetHours = tzName.includes('DT') ? 5 : 6; // CDT=-5, CST=-6
  // The wall-clock time is Central; convert to a true UTC instant by adding the offset.
  return new Date(Date.UTC(y, mo - 1, d, h + offsetHours, mi, se));
}

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

  // ?seedEscalation=1 → ONE-TIME: stamp lastEscalatedAt=now on all current 'Customer Replied' leads WITHOUT
  // sending Slack, so the 2h escalation doesn't re-blast the existing backlog. Run once after a flood.
  if (sp.get('seedEscalation') === '1') {
    const res = await prisma.lsaLead.updateMany({
      where: { status: 'Customer Replied', lastEscalatedAt: null },
      data: { lastEscalatedAt: new Date() },
    });
    return NextResponse.json({ ok: true, seededEscalation: res.count, note: 'Escalation backlog stamped silently. Future overdue replies escalate normally (capped).' });
  }

  const days = Math.min(Number(sp.get('days')) || 7, 730); // default 7d (lightweight); pass ?days=90 for a full backfill
  const only = sp.get('location'); // optional: sync just one location
  const silent = sp.get('silent') === '1'; // suppress all Slack sends (for backfill/seeding)

  // Resolve the LSA accounts to sync. Prefer the JSON map GOOGLE_ADS_LSA_ACCOUNTS
  // ({"Southlake":"123...","Oklahoma City":"..."}); fall back to the single legacy env var (Southlake).
  let accounts: { location: string; customerId: string }[] = [];
  try {
    const raw = process.env.GOOGLE_ADS_LSA_ACCOUNTS;
    if (raw) {
      const parsed = JSON.parse(raw);
      accounts = Object.entries(parsed).map(([location, id]) => ({ location, customerId: clean(String(id)) }));
    }
  } catch (e) {
    return NextResponse.json({ error: 'GOOGLE_ADS_LSA_ACCOUNTS is not valid JSON', detail: String(e) }, { status: 400 });
  }
  if (accounts.length === 0 && process.env.GOOGLE_ADS_LSA_CUSTOMER_ID) {
    accounts = [{ location: 'Southlake', customerId: clean(process.env.GOOGLE_ADS_LSA_CUSTOMER_ID) }];
  }
  if (only) accounts = accounts.filter(a => a.location.toLowerCase() === only.toLowerCase());
  if (accounts.length === 0) return NextResponse.json({ error: 'No LSA accounts configured', hint: 'Set GOOGLE_ADS_LSA_ACCOUNTS (JSON) or GOOGLE_ADS_LSA_CUSTOMER_ID' }, { status: 400 });

  // ?wait=1 → run inline and return the full result (useful for manual/debug runs).
  if (sp.get('wait') === '1') {
    const result = await runAllAccounts(days, accounts, silent);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }
  waitUntil(runAllAccounts(days, accounts, silent).catch(e => { console.error('lsa-sync background error:', e); }));
  return NextResponse.json({ ok: true, started: true, days, silent, accounts: accounts.map(a => a.location), note: 'Sync running in background (fire-and-forget). Use ?wait=1 for inline result.' });
}

// Sync every configured account in turn; aggregate the per-account results.
async function runAllAccounts(days: number, accounts: { location: string; customerId: string }[], silent = false) {
  const results: any[] = [];
  let ok = true;
  for (const acct of accounts) {
    const r = await runSync(days, acct.customerId, acct.location, silent);
    results.push({ location: acct.location, ...r });
    if (!r.ok) ok = false;
  }
  const sum = (k: string) => results.reduce((s, r) => s + (r[k] || 0), 0);
  return {
    ok, accounts: accounts.length,
    leads: sum('leads'), upserted: sum('upserted'), autoBooked: sum('autoBooked'),
    replyCustomerAlerts: sum('replyCustomerAlerts'), newLeadAlerts: sum('newLeadAlerts'), escalated: sum('escalated'),
    perAccount: results,
  };
}

async function runSync(days: number, customerId: string, location: string, silent = false) {
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

    let upserted = 0, autoBooked = 0, replyCustomerAlerts = 0, newLeadAlerts = 0;
    for (const r of leadRows) {
      const L = r.localServicesLead || {};
      const leadId = String(L.id);
      const leadRes = `customers/${customerId}/localServicesLeads/${leadId}`;
      const convs = convByLead.get(leadRes) || [];
      // latest activity + latest message text + who sent the latest event (for stage derivation),
      // plus first outbound reply time and outbound count (for the lag report).
      let lastActivityAt: Date | null = null;
      let lastMessageText: string | null = null;
      let lastParticipant: string | null = null;
      let lastChannel: string | null = null; // channel of the most recent event: 'PHONE_CALL' | 'MESSAGE' | etc.
      let firstReplyAt: Date | null = null;
      let outboundCount = 0;
      for (const c of convs) {
        const t = parseCentral(c.eventDateTime);
        if (t && (!lastActivityAt || t > lastActivityAt)) {
          lastActivityAt = t;
          lastMessageText = c.messageDetails?.text || null;
          lastParticipant = c.participantType || null; // 'ADVERTISER' | 'CONSUMER'
          lastChannel = c.conversationChannel || null;  // 'PHONE_CALL' | 'MESSAGE' | 'EMAIL' etc.
        }
        if (c.participantType === 'ADVERTISER') {
          outboundCount++;
          if (t && (!firstReplyAt || t < firstReplyAt)) firstReplyAt = t; // earliest outbound = first reply
        }
      }
      const contact = L.contactDetails || {};
      const leadType = LEAD_TYPE[L.leadType] || String(L.leadType || 'UNKNOWN');
      const gStatus = LEAD_STATUS[L.leadStatus] || String(L.leadStatus || '');
      const creation = parseCentral(L.creationDateTime);
      const phone = contact.phoneNumber || null;

      // Cross-reference Booked: LSA phone matches a customer with a booked appointment, OR Google BOOKED.
      const normPhone = normalizePhone(phone);
      const isBooked = gStatus === 'BOOKED' || (normPhone ? bookedPhones.has(normPhone) : false);
      const existing = await prisma.lsaLead.findUnique({
        where: { leadId }, select: { manualOverride: true, status: true, replyAlerted: true, newLeadAlerted: true },
      });

      // Phone-call leads are answered live — they don't belong in the message follow-up pipeline.
      // conversation_channel is a ConversationType enum: EMAIL/MESSAGE/PHONE_CALL/SMS. The searchStream JSON
      // usually returns it as a string (like participant_type does), but guard for a numeric enum too
      // (PHONE_CALL = 3 in the proto). Only a CUSTOMER-initiated call counts as "handled live".
      const chan = lastChannel != null ? String(lastChannel).toUpperCase() : '';
      const lastEventWasCustomerCall = (chan === 'PHONE_CALL' || chan === '3') && lastParticipant === 'CONSUMER';
      let statusToSet: string;
      if (leadType === 'PHONE_CALL') {
        statusToSet = 'Call — handled';
      } else if (isBooked) {
        autoBooked++;
        statusToSet = existing?.status?.includes('Lost') ? existing.status : 'Booked';
      } else if (existing?.manualOverride) {
        statusToSet = existing.status;
      } else if (lastEventWasCustomerCall) {
        // Message lead whose most recent activity is the customer CALLING us — that's answered live, so it
        // shouldn't sit in 'Customer Replied' as if a text is waiting. Treat as handled.
        statusToSet = 'Call — handled';
      } else {
        statusToSet = deriveLsaStage({ lastParticipant: lastParticipant as any, lastActivityAt, creationDateTime: creation });
      }

      // ---- Customer-reply Slack alert ----
      // Alert only on a genuine TRANSITION into 'Customer Replied' (prior stored status was something
      // else) AND not already alerted — this prevents the first post-deploy sync from flooding alerts for
      // leads already sitting in 'Customer Replied'. Reset the flag when we've replied (Awaiting Customer)
      // so the next inbound reply re-alerts. Never for call leads.
      let replyAlerted = existing?.replyAlerted ?? false;
      let clearEscalation = false;
      if (leadType !== 'PHONE_CALL') {
        const wasAlready = existing?.status === 'Customer Replied';
        if (statusToSet === 'Customer Replied' && !replyAlerted && !wasAlready) {
          const who = contact.consumerName || phone || `Lead ${leadId}`;
          const snippet = lastMessageText ? ` — "${lastMessageText.slice(0, 100)}"` : '';
          const ok = await postSlack(
            `💬 *New LSA customer reply — needs response* [${location}]\n*${who}*${snippet}\nReply in the LSA app.`, silent
          );
          if (ok) replyAlerted = true;
          replyCustomerAlerts++;
        } else if (statusToSet === 'Customer Replied' && wasAlready) {
          replyAlerted = true;
        } else if (statusToSet === 'Awaiting Customer') {
          replyAlerted = false;
          clearEscalation = true;
        }
      }

      // ---- New incoming message-lead Slack alert ----
      let newLeadAlerted = existing?.newLeadAlerted ?? false;
      if (!existing && leadType === 'MESSAGE' && statusToSet === 'New') {
        const who = contact.consumerName || phone || `Lead ${leadId}`;
        const snippet = lastMessageText ? ` — "${lastMessageText.slice(0, 100)}"` : '';
        const ok = await postSlack(
          `🆕 *New LSA message lead — no reply yet* [${location}]\n*${who}*${snippet}\nReply in the LSA app.`, silent
        );
        if (ok) newLeadAlerted = true;
        newLeadAlerts++;
      }

      await prisma.lsaLead.upsert({
        where: { leadId },
        create: {
          leadId, location, leadType, category: L.categoryId ? String(L.categoryId) : null,
          serviceId: L.serviceId ? String(L.serviceId) : null,
          status: statusToSet, googleLeadStatus: gStatus,
          contactName: contact.consumerName || null, contactPhone: phone,
          leadCharged: L.leadCharged ?? null, note: L.note?.description || null,
          creationDateTime: creation, lastActivityAt, lastParticipant,
          lastMessageText, conversationCount: convs.length, replyAlerted, newLeadAlerted,
          firstReplyAt, outboundCount,
        },
        update: {
          location, leadType, googleLeadStatus: gStatus,
          contactName: contact.consumerName || null, contactPhone: phone,
          leadCharged: L.leadCharged ?? null, note: L.note?.description || null,
          lastActivityAt, lastParticipant, lastMessageText, conversationCount: convs.length,
          status: statusToSet, replyAlerted, newLeadAlerted,
          firstReplyAt, outboundCount,
          ...(clearEscalation ? { lastEscalatedAt: null } : {}),
        },
      });
      upserted++;
    }

    // ---- 2-hour escalation: leads we still haven't replied to ----
    // For leads in 'Customer Replied' where the customer's message is 2+ hours old, re-nag Slack every
    // 3 hours until we reply. Business hours only (7am–10pm Central). This is separate from the per-lead
    // reply alert above — it catches replies that slipped through and are aging on our side.
    // GUARDS against flooding: only replies < 24h old (fresh, actionable), and a hard per-run cap.
    let escalated = 0;
    const MAX_ESCALATIONS_PER_RUN = 8; // safety cap — a scheduled run can never blast the channel
    if (isBusinessHoursCentral()) {
      const now = Date.now();
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      const RENAG = 3 * 60 * 60 * 1000;
      const MAX_AGE = 24 * 60 * 60 * 1000; // only escalate replies < 1 day old; older belong to the daily stale-check
      const waiting = await prisma.lsaLead.findMany({
        where: { status: 'Customer Replied', leadType: { not: 'PHONE_CALL' }, location },
        orderBy: { lastActivityAt: 'desc' },
      });
      for (const l of waiting) {
        if (escalated >= MAX_ESCALATIONS_PER_RUN) break;              // hard cap — never flood
        const since = l.lastActivityAt?.getTime();
        if (!since) continue;
        const age = now - since;
        if (age < TWO_HOURS) continue;                                // not yet 2h old
        if (age > MAX_AGE) continue;                                  // too old for the 2h track
        if (l.lastEscalatedAt && now - l.lastEscalatedAt.getTime() < RENAG) continue; // nagged recently
        const who = l.contactName || l.contactPhone || `Lead ${l.leadId}`;
        const hrs = Math.floor((now - since) / (60 * 60 * 1000));
        const snippet = l.lastMessageText ? ` — "${l.lastMessageText.slice(0, 100)}"` : '';
        const ok = await postSlack(
          `⏰ *LSA reply overdue — ${hrs}h unanswered* [${location}]\n*${who}*${snippet}\nCustomer is waiting. Reply in the LSA app.`, silent
        );
        if (ok) { await prisma.lsaLead.update({ where: { id: l.id }, data: { lastEscalatedAt: new Date() } }); escalated++; }
      }
    }

    return { ok: true, days, leads: leadRows.length, conversations: convRows.length, upserted, autoBooked, replyCustomerAlerts, newLeadAlerts, escalated };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
