// Exclusion Time Estimator.
// Predicts how long an exclusion SHOULD take from the proposal's home-feature quantities × Kyle's per-feature
// duration matrix (story × roof-difficulty), plus a base buffer (paint run + trapping).
//
// Two modes:
//   A) MANUAL (works now, no SmarterLaunch key):
//        POST ?token=critterstop2026   body: { stories:1|2, difficulty:"easy"|"moderate"|"difficult",
//                                               features: { "Pipe Stacks": 5, "Roof Returns": 2, "Weep Holes": true,
//                                                           "Fascia Gaps/Spot Work": 1500, "Peak Protector Ridge Guard": 40 } }
//   B) SMARTERLAUNCH (needs SMARTERLAUNCH_API_KEY in env):
//        GET ?token=critterstop2026&customer_uuid=<SL uuid>   -> pulls quantities + story/difficulty tags, estimates
//
// Returns total minutes/hours + a per-feature breakdown + a PM rule-of-thumb.
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const BASE_PAINT_MIN = 35;      // grab paint sample + run to get actual paint (always applies)
const BASE_TRAPPING_MIN = 30;   // trapping setup — ONLY if the proposal includes trapping

// Kyle's duration matrix: feature -> story -> difficulty -> minutes (per quantity). null = NA/skip.
const FEATURES: Record<string, any> = {"AAC Foundation Vent Guard":{"oneStory":{"easy":null,"moderate":null,"difficult":null},"twoStory":{"easy":null,"moderate":null,"difficult":null}},"AAC Louvered Vent Guard":{"oneStory":{"easy":120.0,"moderate":140.0,"difficult":180.0},"twoStory":{"easy":140.0,"moderate":140.0,"difficult":200.0}},"AAC Power Fan Cover":{"oneStory":{"easy":10.0,"moderate":15.0,"difficult":25.0},"twoStory":{"easy":10.0,"moderate":15.0,"difficult":25.0}},"AC Line":{"oneStory":{"easy":15.0,"moderate":15.0,"difficult":15.0},"twoStory":{"easy":15.0,"moderate":15.0,"difficult":15.0}},"Fascia Gaps/Spot Work 1-1500sqt":{"oneStory":{"easy":90.0,"moderate":90.0,"difficult":120.0},"twoStory":{"easy":120.0,"moderate":120.0,"difficult":140.0}},"Fascia Gaps/Spot Work 1501-2500sqt":{"oneStory":{"easy":90.0,"moderate":90.0,"difficult":120.0},"twoStory":{"easy":120.0,"moderate":120.0,"difficult":140.0}},"Fascia Gaps/Spot Work 2501-3500sqt":{"oneStory":{"easy":120.0,"moderate":120.0,"difficult":140.0},"twoStory":{"easy":140.0,"moderate":140.0,"difficult":160.0}},"Fascia Gaps/Spot Work 3501-4500sqt":{"oneStory":{"easy":150.0,"moderate":150.0,"difficult":170.0},"twoStory":{"easy":170.0,"moderate":170.0,"difficult":190.0}},"Fascia Gaps/Spot Work 4501-7000sqt":{"oneStory":{"easy":180.0,"moderate":180.0,"difficult":200.0},"twoStory":{"easy":200.0,"moderate":200.0,"difficult":220.0}},"Fascia Gaps/Spot Work 7000sqt and above":{"oneStory":{"easy":240.0,"moderate":240.0,"difficult":260.0},"twoStory":{"easy":300.0,"moderate":300.0,"difficult":300.0}},"Ground Vent":{"oneStory":{"easy":10.0,"moderate":10.0,"difficult":10.0},"twoStory":{"easy":10.0,"moderate":10.0,"difficult":10.0}},"Box Vents":{"oneStory":{"easy":10.0,"moderate":15.0,"difficult":25.0},"twoStory":{"easy":10.0,"moderate":15.0,"difficult":25.0}},"Exhaust Vents":{"oneStory":{"easy":15.0,"moderate":15.0,"difficult":15.0},"twoStory":{"easy":15.0,"moderate":15.0,"difficult":15.0}},"Gable Vents":{"oneStory":{"easy":40.0,"moderate":40.0,"difficult":40.0},"twoStory":{"easy":40.0,"moderate":40.0,"difficult":40.0}},"Garage Gaps":{"oneStory":{"easy":10.0,"moderate":10.0,"difficult":10.0},"twoStory":{"easy":10.0,"moderate":10.0,"difficult":10.0}},"Pipe Stacks":{"oneStory":{"easy":5.0,"moderate":5.0,"difficult":10.0},"twoStory":{"easy":5.0,"moderate":5.0,"difficult":10.0}},"Roof Returns":{"oneStory":{"easy":25.0,"moderate":30.0,"difficult":35.0},"twoStory":{"easy":25.0,"moderate":30.0,"difficult":35.0}},"Peak Protector Ridge Guard":{"oneStory":{"easy":{"perLF":3},"moderate":{"perLF":3},"difficult":{"perLF":3}},"twoStory":{"easy":{"perLF":3},"moderate":{"perLF":3},"difficult":{"perLF":3}}},"Quad Vent":{"oneStory":{"easy":15.0,"moderate":15.0,"difficult":20.0},"twoStory":{"easy":15.0,"moderate":15.0,"difficult":20.0}},"RodExit Garage Door Sweep":{"oneStory":{"easy":40.0,"moderate":40.0,"difficult":40.0},"twoStory":{"easy":40.0,"moderate":40.0,"difficult":40.0}},"Saucer Vent":{"oneStory":{"easy":10.0,"moderate":15.0,"difficult":25.0},"twoStory":{"easy":10.0,"moderate":15.0,"difficult":25.0}},"Soffit Vent":{"oneStory":{"easy":15.0,"moderate":15.0,"difficult":15.0},"twoStory":{"easy":15.0,"moderate":15.0,"difficult":15.0}},"Turbine Vent":{"oneStory":{"easy":10.0,"moderate":15.0,"difficult":25.0},"twoStory":{"easy":10.0,"moderate":15.0,"difficult":25.0}},"Weep holes (depends on sq ft)":{"oneStory":{"easy":25.0,"moderate":35.0,"difficult":45.0},"twoStory":{"easy":25.0,"moderate":35.0,"difficult":45.0}}};

// Map SmarterLaunch feature names -> matrix feature names (SL uses slightly different labels).
const SL_ALIAS: Record<string, string> = {
  'Roof Return': 'Roof Returns',
  'Weep Holes': 'Weep holes (depends on sq ft)',
  'Weep holes': 'Weep holes (depends on sq ft)',
  'Ridge Guard': 'Peak Protector Ridge Guard',
  'Peak Protector': 'Peak Protector Ridge Guard',
};
// Features priced as flat-if-present (yes/no) rather than × quantity.
const FLAT_IF_PRESENT = new Set(['Weep holes (depends on sq ft)']);
// Features priced per linear foot (minutes value is per-LF; quantity is LF).
const PER_LF = new Set(['Peak Protector Ridge Guard']);

function fasciaBucket(sqft: number): string | null {
  if (sqft <= 0) return null;
  if (sqft <= 1500) return 'Fascia Gaps/Spot Work 1-1500sqt';
  if (sqft <= 2500) return 'Fascia Gaps/Spot Work 1501-2500sqt';
  if (sqft <= 3500) return 'Fascia Gaps/Spot Work 2501-3500sqt';
  if (sqft <= 4500) return 'Fascia Gaps/Spot Work 3501-4500sqt';
  if (sqft <= 7000) return 'Fascia Gaps/Spot Work 4501-7000sqt';
  return 'Fascia Gaps/Spot Work 7000sqt and above';
}

type Diff = 'easy' | 'moderate' | 'difficult';
function lookup(featureName: string, story: 1 | 2, diff: Diff): number | { perLF: number } | null {
  const f = FEATURES[featureName]; if (!f) return null;
  const col = story === 1 ? f.oneStory : f.twoStory;
  return col ? col[diff] : null;
}

const ADDON_RATE_PER_HR = 175; // Chisam: exclusion add-ons not in Kyle's list (siding/rat wall exclusion, chimney
// repair, etc.) and items whose effort varies a lot by house are budgeted by PRICE ÷ $175/hr, not a fixed time.

function estimate(stories: 1 | 2, difficulty: Diff, features: Record<string, any>, hasTrapping: boolean = true, addOns: { name: string; amount: number }[] = []) {
  const lines: any[] = [];
  let featureMin = 0;
  let addOnMin = 0;
  // Exclusion add-ons (not in Kyle's matrix): budget time from the PM's listed price at $175/hr.
  for (const a of addOns) {
    const amt = Number(a.amount) || 0;
    if (amt <= 0) continue;
    const mins = Math.round((amt / ADDON_RATE_PER_HR) * 60);
    addOnMin += mins;
    lines.push({ feature: a.name, input: `$${amt}`, minutes: mins, note: `add-on @ $${ADDON_RATE_PER_HR}/hr` });
  }
  featureMin += addOnMin;
  for (const [rawName, qtyRaw] of Object.entries(features)) {
    if (qtyRaw == null || qtyRaw === false || qtyRaw === 0 || qtyRaw === '0') continue;
    // Resolve the matrix feature name.
    let name = SL_ALIAS[rawName] || rawName;
    let qty: number = typeof qtyRaw === 'boolean' ? (qtyRaw ? 1 : 0) : parseFloat(String(qtyRaw)) || 0;

    // Trapping: a sold line item worth a flat 30-min time allotment (NOT part of exclusion revenue).
    if (name.toLowerCase().startsWith('trapping')) {
      featureMin += BASE_TRAPPING_MIN; lines.push({ feature: 'Trapping', input: 'present', minutes: BASE_TRAPPING_MIN, note: 'flat trapping time' });
      continue;
    }
    // Fascia: the quantity is sq-ft -> pick the bucket, flat time.
    if (name.toLowerCase().startsWith('fascia')) {
      const bucket = fasciaBucket(qty); if (!bucket) continue;
      const mins = lookup(bucket, stories, difficulty);
      if (typeof mins === 'number') { featureMin += mins; lines.push({ feature: bucket, input: `${qty} sqft`, minutes: mins, note: 'flat per sqft bucket' }); }
      continue;
    }
    const val = lookup(name, stories, difficulty);
    // Not an exclusion time-driver (guarantees, insulation, fogging, attic inspection, fees, etc.) — omit from the
    // exclusion-time breakdown entirely rather than listing it as "0 min".
    if (val == null) continue;
    if (typeof val === 'object' && 'perLF' in val) { // Ridge Guard: per linear foot
      const mins = val.perLF * qty; featureMin += mins; lines.push({ feature: name, input: `${qty} LF`, minutes: mins, note: `${val.perLF} min/LF` }); continue;
    }
    if (FLAT_IF_PRESENT.has(name)) { featureMin += (val as number); lines.push({ feature: name, input: 'present', minutes: val, note: 'flat if present' }); continue; }
    const mins = (val as number) * qty; featureMin += mins; lines.push({ feature: name, input: qty, minutes: mins, note: `${val} min each` });
  }
  // Base buffer is now just the paint run (trapping is handled as its own line item above when sold).
  const baseBufferTotal = BASE_PAINT_MIN;
  const totalMin = featureMin + baseBufferTotal;
  const totalHours = Math.round((totalMin / 60) * 100) / 100;
  return {
    stories, difficulty,
    baseBuffer: { paint: BASE_PAINT_MIN, total: baseBufferTotal },
    featureMinutes: Math.round(featureMin),
    totalMinutes: Math.round(totalMin),
    totalHours,
    ruleOfThumb: `~${Math.round(totalHours)} hrs (${totalHours} exact). PM: book ~${Math.round(totalHours)}h; Service Mgr adjusts ~5 days out.`,
    breakdown: lines,
  };
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const stories = (parseInt(String(body.stories)) === 2 ? 2 : 1) as 1 | 2;
  const difficulty = (['easy', 'moderate', 'difficult'].includes(String(body.difficulty)) ? body.difficulty : 'easy') as Diff;
  const features = body.features || {};
  const hasTrapping = body.hasTrapping !== false; // default true unless explicitly false
  return NextResponse.json(estimate(stories, difficulty, features, hasTrapping));
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // List the feature catalog (for reference / building manual requests).
  if (sp.get('catalog') === '1') {
    return NextResponse.json({ basePaint: BASE_PAINT_MIN, baseTrappingIfPresent: BASE_TRAPPING_MIN, features: FEATURES, aliases: SL_ALIAS });
  }

  const custUuid = sp.get('customer_uuid');
  if (!custUuid) return NextResponse.json({ note: 'POST feature quantities to estimate, or GET with &customer_uuid=<SL uuid> (needs SMARTERLAUNCH_API_KEY), or &catalog=1 to see the feature table.' });

  const KEY = process.env.SMARTERLAUNCH_API_KEY;
  if (!KEY) return NextResponse.json({ error: 'SMARTERLAUNCH_API_KEY not set in env — add it to enable auto-pull from proposals.' }, { status: 400 });

  // Pull the customer's accepted Permanent Rodent Solution proposal, read quantities + tags.
  const slBase = 'https://api.smarterlaunch.com/api/v1';
  const h = { 'X-API-Key': KEY, 'Accept': 'application/json' };
  const pr = await fetch(`${slBase}/proposals?customer_uuid=${custUuid}`, { headers: h }).then(r => r.json()).catch(() => null);
  const props = (pr?.data || []).filter((p: any) => String(p.proposal_template_title || '').includes('Permanent Rodent Solution'));
  const accepted = props.find((p: any) => (p.status?.status_code === 'PROPOSAL_ACCEPTED')) || props[0];
  if (!accepted) return NextResponse.json({ error: 'No Permanent Rodent Solution proposal found for this customer.' });

  const det = await fetch(`${slBase}/proposals/${accepted.uuid}`, { headers: h }).then(r => r.json()).catch(() => null);
  const d = det?.data || {};
  const tags = (d.tags || []).map((t: any) => String(t.name || ''));
  const stories = tags.some((t: string) => t.includes('2 Story')) ? 2 : 1;
  // New tag names: "Roof Difficulty - Easy/Moderate/Difficult" → parse the value AFTER the dash (note: the label
  // "Roof Difficulty" itself contains the substring "difficult", so match on the value part, not the whole tag).
  // Backward-compat: old "Roof Difficulty Level 1/2/3".
  const diffTagRaw = tags.find((t: string) => t.toLowerCase().includes('roof difficulty')) || '';
  const diffValue = (diffTagRaw.includes('-') ? diffTagRaw.split('-').pop() : diffTagRaw).toLowerCase().trim();
  const difficulty: Diff =
    diffValue.includes('difficult') || diffValue.includes('3') ? 'difficult' :
    diffValue.includes('moderate') || diffValue.includes('2') ? 'moderate' :
    'easy';

  // Feature quantities: pricingGroupValues (uuid -> qty) joined to feature names.
  const pv = d.latest_version?.proposal_values || {};
  const pgv = pv.pricingGroupValues || {};
  const nameByUuid: Record<string, string> = {};
  (function walk(o: any) { if (o && typeof o === 'object') { if (o.uuid && o.name && typeof o.uuid === 'string' && o.uuid.length === 36 && !(o.uuid in nameByUuid)) nameByUuid[o.uuid] = o.name; for (const v of Object.values(o)) walk(v); } })(d);
  // Only include SOLD line items: a pricing group is selected when its value is truthy (true, a positive
  // number, or a non-"0" string). Unselected groups (0 / false / "" ) and the unsold guarantee options are skipped.
  const isSelected = (v: any) => v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0');
  const features: Record<string, any> = {};
  for (const [uuid, qty] of Object.entries(pgv)) { const nm = nameByUuid[uuid]; if (nm && isSelected(qty)) features[nm] = qty; }

  // Does the proposal include Trapping? (a Trapping section with a selected pricing group)
  // Detect trapping from the SELECTED values. The Trapping pricing-group UUIDs are stable across proposals
  // ("Trapping" b55c7c6e, "Trapping (Limited)" a931cd3c). Also fall back to any group named "Trapping" in the
  // catalog. Trapping is a TIME buffer only — it's never added to exclusion revenue (that sums the Exclusion
  // section only), so mapping it here has no revenue effect.
  const TRAPPING_GROUP_UUIDS = new Set<string>(['b55c7c6e-d56c-477e-b138-6b4a20822c41', 'a931cd3c-19db-4f45-81be-9d5ef39ae1ac']);
  // add any catalog group literally named "Trapping" (covers OKC/other templates with different UUIDs)
  (function walk(o: any) {
    if (o && typeof o === 'object') {
      if (o.uuid && typeof o.name === 'string' && /^trapping/i.test(o.name.trim())) TRAPPING_GROUP_UUIDS.add(o.uuid);
      for (const v of Object.values(o)) walk(v);
    }
  })(d);
  let hasTrapping = false;
  for (const [uuid, val] of Object.entries(pgv)) {
    if (TRAPPING_GROUP_UUIDS.has(uuid) && (val === true || (typeof val === 'string' && val !== '' && val !== '0') || (typeof val === 'number' && val > 0))) { hasTrapping = true; break; }
  }
  // Build EXCLUSION ADD-ONS: items in the Exclusion service plan that are NOT in Kyle's time matrix (custom
  // spot work, siding/rat wall exclusion, chimney repair, etc.). These get budgeted by price ÷ $175/hr.
  const EXCLUSION_PLAN_UUID = '8f1a0c83-ae90-4d1b-b034-a84867d5455f';
  const knownNames = new Set(Object.keys(FEATURES).map(n => n.toLowerCase()));
  const isKyleItem = (nm: string) => {
    const mapped = (SL_ALIAS[nm] || nm).toLowerCase();
    return knownNames.has(mapped) || mapped.startsWith('fascia') || mapped.startsWith('trapping') || mapped === 'peak protector ridge guard';
  };
  const addOns: { name: string; amount: number }[] = [];
  // (a) standard exclusion pricing_groups that are selected, priced, and NOT in Kyle's list
  const exclPlan = (d.proposal_service_plans || []).find((p: any) => (p.service_plan?.uuid || p.service_plan_data?.uuid) === EXCLUSION_PLAN_UUID);
  // (b) custom add-ons live in proposal_values.servicePlanAdditionalPricing[EXCLUSION_PLAN_UUID]
  const addlPricing = (pv.servicePlanAdditionalPricing || {})[EXCLUSION_PLAN_UUID] || [];
  for (const ap of addlPricing) {
    const amt = Array.isArray(ap.price) ? Number(ap.price[0]) : Number(ap.price);
    if (ap.isSelected !== false && amt > 0 && !isKyleItem(String(ap.groupName || ''))) {
      addOns.push({ name: ap.groupName || 'Add-on', amount: amt });
    }
  }
  // (c) edited standard items not in Kyle's list (rare) — from editedValues with a price
  const edited = pv.editedValues || {};
  for (const [uuid, ev] of Object.entries<any>(edited)) {
    const nm = nameByUuid[uuid]; if (!nm || isKyleItem(nm)) continue;
    const amt = Array.isArray(ev.price) ? Number(ev.price[0]) : Number(ev.price);
    // only count if it's an exclusion-section group (best-effort: skip insulation/fogging/trapping names)
    if (amt > 0 && !/insulation|fogging|hazardous|can light|air flow|attic|guarantee|disposal/i.test(nm)) {
      if (!addOns.some(a => a.name === nm)) addOns.push({ name: nm, amount: amt });
    }
  }
  const est = estimate(stories as 1 | 2, difficulty, features, hasTrapping, addOns);
  const customerName = d.customer?.account_name || d.customer_account_name || accepted.customer_account_name
    || [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(' ').trim() || null;
  const frId = d.customer?.integrations?.pest_routes?.identifier || d.customer?.integration_customer_identifier
    || accepted.customer?.integrations?.pest_routes?.identifier || null;
  return NextResponse.json({ customer_uuid: custUuid, customer: customerName, frCustomerId: frId, proposal: accepted.title, status: accepted.status?.display_name, tagsFound: tags, ...est });
}
