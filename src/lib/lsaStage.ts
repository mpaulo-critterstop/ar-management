// LSA follow-up stage derivation — computed automatically from conversation activity, NOT hand-set.
// Stages: New -> Awaiting Customer -> Customer Replied -> Need Follow-up (loop), plus Booked / Lost.
//
//   New              : no outbound (ADVERTISER) message yet
//   Awaiting Customer: our last message was outbound (we replied; ball on them)
//   Customer Replied : customer's (CONSUMER) message is the latest (ball back on us)
//   Need Follow-up   : last was outbound AND >= staleDays with no reply
//   Booked           : set by cross-reference (phone -> customer with booked appt); handled by caller
//   Lost             : manual only
//
// Manual overrides are respected by the caller (skip derivation when manualOverride = true).

export const LSA_STAGES = ['New', 'Awaiting Customer', 'Customer Replied', 'Need Follow-up', 'Booked', 'Lost'] as const;
export type LsaStage = typeof LSA_STAGES[number];

export interface DeriveInput {
  lastParticipant: 'ADVERTISER' | 'CONSUMER' | null; // sender of the most recent conversation event
  lastActivityAt: Date | null;
  creationDateTime: Date | null;
  staleDays?: number; // default 1
  now?: Date;
}

// Returns the auto-derived stage for the follow-up loop (does NOT decide Booked/Lost — those are set
// by the caller from cross-reference / manual action).
export function deriveLsaStage(input: DeriveInput): LsaStage {
  const staleDays = input.staleDays ?? 1;
  const now = input.now ?? new Date();
  const last = input.lastActivityAt || input.creationDateTime;

  // No outbound reply from us yet → New (regardless of how many inbound msgs).
  if (input.lastParticipant !== 'ADVERTISER' && input.lastParticipant !== 'CONSUMER') return 'New';

  if (input.lastParticipant === 'CONSUMER') {
    // Customer spoke last — ball is on us.
    return 'Customer Replied';
  }

  // lastParticipant === 'ADVERTISER' — we replied last. Awaiting the customer, unless stale.
  if (last) {
    const ageDays = (now.getTime() - last.getTime()) / 86400000;
    if (ageDays >= staleDays) return 'Need Follow-up';
  }
  return 'Awaiting Customer';
}

// Normalize a phone number to its last 10 digits for cross-source matching (LSA vs Hub formats differ).
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

// Is `now` within business hours (default 7am–10pm) in US Central time? Used to gate escalation alerts
// so the team isn't pinged overnight.
export function isBusinessHoursCentral(now: Date = new Date(), startHour = 7, endHour = 22): boolean {
  // Get the current hour in America/Chicago regardless of server TZ.
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
  }).format(now);
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0; // some environments render midnight as 24
  return hour >= startHour && hour < endHour;
}
