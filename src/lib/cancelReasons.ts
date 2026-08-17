// Normalize FieldRoutes free-text cancellation notes (cxlNotes) into reason buckets for churn reporting.
// FR appends a "[Canceled: <service> - <id>]" tag to the note; we strip that first, then keyword-match.
// Free-text is messy and rep-dependent, so this is best-effort — the raw note is always kept alongside.

export interface ReasonResult { bucket: string; cleaned: string; }

// Order matters: more specific/actionable buckets first.
const RULES: { bucket: string; re: RegExp }[] = [
  // Administrative / non-decision cancels (surfaced but excluded from win-back).
  { bucket: 'Bundle Cascade',      re: /parent bundle\s+\d+\s+cancel|due to (parent )?bundle/i },
  { bucket: 'Contract Expired',    re: /\b(subscription expired|expired on|contract expire|expiration)\b/i },
  { bucket: 'Non-Renewal',         re: /\b(do not (wish to )?renew|don'?t (wish to )?renew|not renew(ing)?|done with (the )?contract|end of (the )?(agreement|contract|term)|complete(d)? (the )?(agreement|contract))\b/i },
  { bucket: 'Duplicate / Admin',   re: /\b(duplicate|2 accounts|two accounts|error|mistake|wrong|test|admin|re.?enter|resign|re.?sign|transfer|never agreed|created a new sub)\b/i },
  // Customer-decision cancels.
  { bucket: 'DIY / Self-Service',  re: /\b(themselves|in.?house|do (the )?treatment|own (their|the) (pest|treatment)|self|treat (exterior|it) (on (their|her|his) own))\b/i },
  { bucket: 'As-Needed / Paused',  re: /\b(as.?needed|on hold|check back|hold (off|till|until)|pause|for now|reaches? out|call (us )?back|when (they|she|he) )\b/i },
  { bucket: 'Moved / Relocated',   re: /\b(moved|moving|relocat|out of state|out of the area|sold (the )?(house|home)|new (house|home|address)|new owner|no longer (live|reside)|occupying)\b/i },
  { bucket: 'Price / Cost',        re: /\b(price|pricing|cost|expensive|afford|budget|too much|money|charge too|rate|financial|hardship)\b/i },
  { bucket: 'Dissatisfied / Service Quality', re: /\b(unhappy|dissatisf|not happy|not interested|poor service|bad service|complaint|frustrat|lack of communication|no communication|not communicat|scheduling (issue|conflict)|not adequate|inadequate|not working|didn'?t work|ineffective|still (have|seeing)|bugs? (are )?back|not satisf|damaged|not contact|never (came|showed)|will not confirm|cannot go)\b/i },
  { bucket: 'No Longer Needed',    re: /\b(no longer need|don'?t need|not need|no (more )?service|does not want service|doesn'?t want service|not want (the )?service|no issues?|problem (is )?(gone|resolved)|no more (bugs?|pests?)|seasonal)\b/i },
  { bucket: 'Going with Competitor', re: /\b(competitor|another (company|provider|pc|pest)|new (company|pc|provider)|other company|other (pest )?provider|switch(ing|ed)?|different (company|provider)|found (someone|another)|cheaper elsewhere|conflict of interest|gone with|going with|offers? (sealing|more))\b/i },
  { bucket: 'Deceased / Health',   re: /\b(deceased|passed away|died|health|hospital|nursing home|elderly|heart (issue|condition|problem)|medical)\b/i },
  { bucket: 'Non-Payment / Billing', re: /\b(non.?payment|didn'?t pay|not pay|billing|payment issue|declined|collections|delinquent)\b/i },
  { bucket: 'Renter / Moved Out',  re: /\b(renter|tenant|landlord|lease|rental)\b/i },
];

// Strip FR's auto-appended "[Canceled: ...]" and "(due to parent bundle N canceled)" tags, the
// "[Froze Customer]" status prefix, and tidy whitespace — leaving the human-entered reason (if any).
export function cleanCxlNote(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\[canceled:[^\]]*\]/i, '')
    .replace(/\[froze customer\]/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bucketCancelReason(raw: string | null | undefined): ReasonResult {
  const rawStr = (raw || '').toString();
  // Bundle-cascade is detected on the RAW text (the tag is stripped during cleaning). A child sub with
  // ONLY the bundle tag and no human note is an administrative cascade, not a customer decision.
  const bundleMatch = /parent bundle\s+\d+\s+cancel|due to (parent )?bundle/i.test(rawStr);
  const cleaned = cleanCxlNote(raw);
  if (!cleaned) return bundleMatch
    ? { bucket: 'Bundle Cascade', cleaned: '' }
    : { bucket: 'No Reason Given', cleaned: '' };
  // If there's a human note alongside a bundle tag, prefer the human reason — fall through to rules,
  // but if nothing matches, call it Bundle Cascade rather than Other.
  for (const { bucket, re } of RULES) {
    if (re.test(cleaned)) return { bucket, cleaned };
  }
  return { bucket: bundleMatch ? 'Bundle Cascade' : 'Other', cleaned };
}

// All buckets (for report scaffolding / ordering).
export const REASON_BUCKETS = [
  'Bundle Cascade', 'Contract Expired', 'Non-Renewal', 'Duplicate / Admin', 'DIY / Self-Service',
  'As-Needed / Paused', 'Moved / Relocated', 'Price / Cost', 'Dissatisfied / Service Quality',
  'No Longer Needed', 'Going with Competitor', 'Deceased / Health', 'Non-Payment / Billing',
  'Renter / Moved Out', 'Other', 'No Reason Given',
];
