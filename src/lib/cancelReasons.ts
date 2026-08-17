// Normalize FieldRoutes free-text cancellation notes (cxlNotes) into reason buckets for churn reporting.
// FR appends a "[Canceled: <service> - <id>]" tag to the note; we strip that first, then keyword-match.
// Free-text is messy and rep-dependent, so this is best-effort — the raw note is always kept alongside.

export interface ReasonResult { bucket: string; cleaned: string; }

// Order matters: more specific/actionable buckets first. 'Moved/Relocated' before generic price, etc.
const RULES: { bucket: string; re: RegExp }[] = [
  { bucket: 'Moved / Relocated',   re: /\b(moved|moving|relocat|out of state|out of the area|sold (the )?(house|home)|new (house|home|address)|no longer (live|reside))\b/i },
  { bucket: 'Price / Cost',        re: /\b(price|pricing|cost|expensive|afford|budget|too much|money|charge too|rate)\b/i },
  { bucket: 'Dissatisfied / Service Quality', re: /\b(unhappy|dissatisf|not happy|poor service|bad service|complaint|not working|didn'?t work|ineffective|still (have|seeing)|bugs? (are )?back|not satisf)\b/i },
  { bucket: 'No Longer Needed',    re: /\b(no longer need|don'?t need|not need|no issues?|problem (is )?(gone|resolved)|no more (bugs?|pests?)|seasonal)\b/i },
  { bucket: 'Going with Competitor', re: /\b(competitor|another (company|provider)|switch(ing|ed)?|different (company|provider)|found (someone|another)|cheaper elsewhere)\b/i },
  { bucket: 'Deceased / Health',   re: /\b(deceased|passed away|died|health|hospital|nursing home|elderly)\b/i },
  { bucket: 'Non-Payment / Billing', re: /\b(non.?payment|didn'?t pay|not pay|billing|payment issue|declined|collections|delinquent)\b/i },
  { bucket: 'Duplicate / Admin',   re: /\b(duplicate|error|mistake|wrong|test|admin|re.?enter|resign|re.?sign|transfer)\b/i },
  { bucket: 'Renter / Moved Out',  re: /\b(renter|tenant|landlord|lease|rental)\b/i },
];

// Strip FR's auto-appended "[Canceled: ... ]" tag and tidy whitespace.
export function cleanCxlNote(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\[canceled:[^\]]*\]/i, '').replace(/\s+/g, ' ').trim();
}

export function bucketCancelReason(raw: string | null | undefined): ReasonResult {
  const cleaned = cleanCxlNote(raw);
  if (!cleaned) return { bucket: 'No Reason Given', cleaned: '' };
  for (const { bucket, re } of RULES) {
    if (re.test(cleaned)) return { bucket, cleaned };
  }
  return { bucket: 'Other', cleaned };
}

// All buckets (for report scaffolding / ordering).
export const REASON_BUCKETS = [
  'Moved / Relocated', 'Price / Cost', 'Dissatisfied / Service Quality', 'No Longer Needed',
  'Going with Competitor', 'Deceased / Health', 'Non-Payment / Billing', 'Duplicate / Admin',
  'Renter / Moved Out', 'Other', 'No Reason Given',
];
