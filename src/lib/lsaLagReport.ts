// LSA lag report computation — shared by the in-Hub report page and the Excel export so both are identical.
//
// Two clearly-distinct metrics, both from real message-level data:
//   1) TIME TO FIRST REPLY  = firstReplyAt - creationDateTime. "How fast did we engage?" Lower = better.
//      (Leads with no outbound reply = never replied → counted in a 'No reply' bucket.)
//   2) FOLLOW-UP DEPTH LAG   = lastActivityAt - creationDateTime, matching Chisam's 'last activity' proxy
//      but computed from the real conversation. Higher-day buckets = sustained follow-up.
//
// Buckets match Chisam's July file: 0, 1, 2, 3, 4+ days (whole-day differences). Segments: All / Wildlife
// (category 'Rodents') / Pest (everything else). Message leads only (calls are handled live).

export interface LsaLagRow {
  creationDateTime: Date | null;
  firstReplyAt: Date | null;
  lastActivityAt: Date | null;
  category: string | null;
  leadType: string;
}

export type Segment = 'All' | 'Wildlife' | 'Pest';
const DAY = 86400000;

export function segmentOf(category: string | null): 'Wildlife' | 'Pest' {
  // Chisam's file: Wildlife = Job type exactly 'Rodents'; everything else (incl. blank) = Pest.
  return (category || '').toLowerCase() === 'rodents' ? 'Wildlife' : 'Pest';
}

function dayBucket(ms: number | null): '0' | '1' | '2' | '3' | '4+' | null {
  if (ms == null) return null;
  const days = Math.floor(ms / DAY);
  if (days <= 0) return '0';
  if (days === 1) return '1';
  if (days === 2) return '2';
  if (days === 3) return '3';
  return '4+';
}

export interface BucketCounts { '0': number; '1': number; '2': number; '3': number; '4+': number; noReply?: number; total: number; }
function emptyBuckets(): BucketCounts { return { '0': 0, '1': 0, '2': 0, '3': 0, '4+': 0, noReply: 0, total: 0 }; }

// Period key helpers
function monthKey(d: Date): string { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
function monthLabel(d: Date): string { return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }
// ISO week key (year-Www) + a readable label of the week's Monday
function weekInfo(d: Date): { key: string; label: string } {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;            // Mon=1..Sun=7
  dt.setUTCDate(dt.getUTCDate() - day + 1);   // back to Monday
  const monday = new Date(dt);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt.getTime() - yearStart.getTime()) / DAY) + 1) / 7);
  return {
    key: `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
    label: `Wk of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`,
  };
}

export interface PeriodReport {
  key: string; label: string;
  firstReply: BucketCounts;    // time-to-first-reply distribution
  depth: BucketCounts;         // follow-up-depth (last-activity) distribution
}

// Build the full report for one segment across periods. metricPeriod = 'month' | 'week'.
export function buildReport(rows: LsaLagRow[], seg: Segment, period: 'month' | 'week'): PeriodReport[] {
  const filtered = rows.filter(r => {
    if (r.leadType !== 'MESSAGE') return false;          // message leads only
    if (!r.creationDateTime) return false;
    if (seg === 'All') return true;
    return segmentOf(r.category) === seg;
  });

  const map = new Map<string, PeriodReport>();
  for (const r of filtered) {
    const created = r.creationDateTime!;
    const { key, label } = period === 'month'
      ? { key: monthKey(created), label: monthLabel(created) }
      : weekInfo(created);
    if (!map.has(key)) map.set(key, { key, label, firstReply: emptyBuckets(), depth: emptyBuckets() });
    const pr = map.get(key)!;

    // Metric 1: time to first reply
    if (r.firstReplyAt) {
      const b = dayBucket(r.firstReplyAt.getTime() - created.getTime());
      if (b) { pr.firstReply[b]++; pr.firstReply.total++; }
    } else {
      pr.firstReply.noReply = (pr.firstReply.noReply || 0) + 1;
      pr.firstReply.total++;
    }

    // Metric 2: follow-up depth (last activity - received)
    const last = r.lastActivityAt || created;
    const b2 = dayBucket(last.getTime() - created.getTime());
    if (b2) { pr.depth[b2]++; pr.depth.total++; }
  }

  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}
