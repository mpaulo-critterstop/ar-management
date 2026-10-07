// Collections / SCC / Bad-Debt rules engine. Parameterized so the day-counts (pending Chisam's final A/B
// answer + ARM-history) are config, not hardcoded — change them in one place and the whole system updates.
import { prisma } from '@/lib/prisma';

// ── CONFIG (defaults; overridable via app_settings key 'collections_config') ──────────────────────────
// NOTE: entry days are PENDING Chisam's clarification (A: 30/45 entry→45/60 total, or B: 45/60 entry→60/75).
// Defaulting to Interpretation A (his original-design restatement). Flip ENTRY_* if he confirms B.
export type CollectionsConfig = {
  amountCutoff: number;        // < cutoff → COLLECTIONS, >= cutoff → SCC
  collectionsEntryDays: number; // days past due to enter COLLECTIONS
  sccEntryDays: number;         // days past due to enter SCC
  countdownDays: number;        // base countdown once entered
  finalWarningDaysLeft: number; // flag at this many days left
  respondedExtensionDays: number; // +days from actual response date
  promisedExtensionDays: number;  // +days from actual promise date (total, not additive to responded)
  badDebtDaysAfterARM: number;    // days after Sent-to-ARM with no payment → Bad Debt proposal
  badDebtDaysAfterSCC: number;    // days after SCC-Filed with no payment → Bad Debt proposal
};

export const DEFAULT_CONFIG: CollectionsConfig = {
  amountCutoff: 750,
  collectionsEntryDays: 30,   // ⚠ pending Chisam A/B — A: 30 (total 45 to ARM)
  sccEntryDays: 45,           // ⚠ pending Chisam A/B — A: 45 (total 60 to SCC)
  countdownDays: 15,
  finalWarningDaysLeft: 7,
  respondedExtensionDays: 15,
  promisedExtensionDays: 30,
  badDebtDaysAfterARM: 45,    // ⚠ pending ARM historical turnaround (Chisam floated 45)
  badDebtDaysAfterSCC: 60,
};

export async function getConfig(): Promise<CollectionsConfig> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'collections_config' } });
    if (row?.value) return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
  } catch { /* fall through to default */ }
  return DEFAULT_CONFIG;
}

export async function saveConfig(cfg: Partial<CollectionsConfig>) {
  const merged = { ...(await getConfig()), ...cfg };
  await prisma.appSetting.upsert({
    where: { key: 'collections_config' },
    create: { key: 'collections_config', value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  });
  return merged;
}

const DAY = 86400000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

// Compute the current countdown deadline from entry + engagement (per Chisam's rules):
//   base = entry + 15d. Responded → responseDate + 15d. Promised → promiseDate + 30d.
// Promised supersedes Responded (it's +30 total from the promise date, the strongest grace).
export function computeCountdownEnd(cfg: CollectionsConfig, enteredAt: Date, respondedAt: Date | null, promisedAt: Date | null): Date {
  if (promisedAt) return addDays(promisedAt, cfg.promisedExtensionDays);
  if (respondedAt) return addDays(respondedAt, cfg.respondedExtensionDays);
  return addDays(enteredAt, cfg.countdownDays);
}

// Derive display state for a tracker row (days left, flags) — read-only, computed live.
export function deriveState(cfg: CollectionsConfig, row: {
  stage: string; countdownEnd: Date; sentAt: Date | null; track: string;
}, now = new Date()) {
  const daysLeft = daysBetween(now, row.countdownEnd);
  const isCountdownStage = row.stage === 'COUNTDOWN' || row.stage === 'FINAL_WARNING';
  const finalWarning = isCountdownStage && daysLeft <= cfg.finalWarningDaysLeft && daysLeft > 0;
  const actionDue = isCountdownStage && daysLeft <= 0; // 0-day: send to ARM / file SCC
  // post-action → bad-debt proposal window
  let badDebtDueInDays: number | null = null;
  if (row.stage === 'SENT' && row.sentAt) {
    const window = row.track === 'SCC' ? cfg.badDebtDaysAfterSCC : cfg.badDebtDaysAfterARM;
    badDebtDueInDays = daysBetween(now, addDays(row.sentAt, window));
  }
  return {
    daysLeft,
    finalWarning,          // 7-day flag (final-warning mode)
    actionDue,             // 0-day flag (ARM/SCC action pending)
    badDebtDueInDays,      // negative = overdue for bad-debt proposal
    badDebtDue: badDebtDueInDays !== null && badDebtDueInDays <= 0,
  };
}

// The track an invoice belongs to by amount.
export function trackFor(cfg: CollectionsConfig, amount: number): 'COLLECTIONS' | 'SCC' {
  return amount >= cfg.amountCutoff ? 'SCC' : 'COLLECTIONS';
}
