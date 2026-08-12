// Pest Control commission computation — final spec (verified with Mark, session 39).
// Pure functions so they can be validated against the Excel's known historical totals before going live.
//
// Categories & rates (all on Contract Value):
//   General Pest Control : MARGINAL by monthly sale COUNT (only GPC sales count) ordered by initial-
//                          service completion date — sales 1-5 = 30%, 6-10 = 40%, 11+ = 50%.
//   Termite              : per sale by CV — <1000=10%, 1001-1599=15%, 1600+=20%.
//   Rodent Bundle        : per sale by CV — <1000=8%, 1001-1798=10%, 1799+=12%. (bundles + standalone rodent)
//   Mosquito             : 10% flat.   Mosquito Misting: 5% flat.
//   Bed Bugs             : 5% flat.    Flea & German Roaches: 10% flat.
//   Bait Station (standalone): 10% flat.   Fly Control (standalone): 10% flat.
// Commission only once initial service completed; attributed to completion month.

export type PestCommCategory =
  | 'Pest Control' | 'Termite' | 'Rodent Bundle'
  | 'Mosquito' | 'Mosquito Misting' | 'Bed Bugs' | 'Flea & German Roaches'
  | 'Bait Station' | 'Fly Control' | 'EXCLUDE';

// ---- Sub-classifier: given FR category + service name, return the COMMISSION category. ----
// isBundle = this sub is a bundle (parent -1) or belongs to one (counted as Rodent Bundle already).
export function classifyPestCommission(frCategory: string, serviceName: string, opts?: { isBundle?: boolean; isStandaloneRodent?: boolean }): PestCommCategory {
  const n = (serviceName || '').toLowerCase();
  if (opts?.isBundle) return 'Rodent Bundle';
  // Inspections never count (even specialty inspections like Bed Bug Inspection).
  if (/inspection/.test(n)) return 'EXCLUDE';
  if (/reservice|call\s*back|callback|\blead\b|follow\s*up|pretreatment/.test(n)) return 'EXCLUDE';

  if (frCategory === 'Termite') {
    // termite renewals/monitoring/removal are real products; only exclude the non-sales handled above
    return 'Termite';
  }
  if (frCategory !== 'Pest Control') return 'EXCLUDE'; // wildlife/subtermites/general/blank/mole

  // Within FR "Pest Control": peel off the specialties by name.
  if (opts?.isStandaloneRodent || /\brodent\b/.test(n)) return 'Rodent Bundle';   // standalone rodent → rodent rates
  if (/mist|mistaway/.test(n)) return 'Mosquito Misting';
  if (/mosquito/.test(n)) return 'Mosquito';
  if (/bed\s*bug/.test(n)) return 'Bed Bugs';
  if (/flea|roach|german/.test(n)) return 'Flea & German Roaches';
  if (/bait\s*station/.test(n)) return 'Bait Station';   // standalone (bundle members handled by isBundle)
  if (/fly\s*control/.test(n)) return 'Fly Control';
  return 'Pest Control'; // general pest control → count tiers
}

// ---- Per-sale flat/bracket rate (everything EXCEPT General Pest Control, which is count-based) ----
export function perSaleRate(category: PestCommCategory, cv: number): number {
  switch (category) {
    case 'Termite':
      if (cv >= 1600) return 0.20;
      if (cv >= 1001) return 0.15;
      return 0.10;
    case 'Rodent Bundle':
      if (cv >= 1799) return 0.12;
      if (cv >= 1001) return 0.10;
      return 0.08;
    case 'Mosquito': return 0.10;
    case 'Mosquito Misting': return 0.05;
    case 'Bed Bugs': return 0.05;
    case 'Flea & German Roaches': return 0.10;
    case 'Bait Station': return 0.10;
    case 'Fly Control': return 0.10;
    default: return 0;
  }
}

// ---- General Pest Control: MARGINAL by count. Given the month's GPC sales ordered by initial-service
// completion date, sale at 1-based index i gets: i<=5 →30%, 6-10 →40%, 11+ →50%, on its own CV. ----
export function gpcRateForIndex(index1based: number): number {
  if (index1based >= 11) return 0.50;
  if (index1based >= 6) return 0.40;
  return 0.30;
}

export interface PestSaleInput {
  category: PestCommCategory;   // already-classified commission category
  cv: number;
  initialCompletedAt: Date | null;  // null = pending (no commission)
}

// Compute one PM's total pest commission for a month from their COMPLETED sales that month.
// GPC sales are ordered by completion date and taxed marginally by count; all others per-sale.
export function computePmMonthCommission(sales: PestSaleInput[]): { total: number; byCategory: Record<string, number> } {
  const byCategory: Record<string, number> = {};
  const add = (cat: string, amt: number) => { byCategory[cat] = (byCategory[cat] || 0) + amt; };

  // Only completed sales earn commission.
  const done = sales.filter(s => s.initialCompletedAt != null && s.category !== 'EXCLUDE');

  // General Pest Control — marginal by count, ordered by completion date.
  const gpc = done.filter(s => s.category === 'Pest Control')
    .sort((a, b) => (a.initialCompletedAt!.getTime() - b.initialCompletedAt!.getTime()));
  gpc.forEach((s, i) => {
    const rate = gpcRateForIndex(i + 1);
    add('Pest Control', s.cv * rate);
  });

  // Everything else — per-sale rate.
  for (const s of done) {
    if (s.category === 'Pest Control') continue;
    add(s.category, s.cv * perSaleRate(s.category, s.cv));
  }

  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
  return { total, byCategory };
}
