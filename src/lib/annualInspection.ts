// Shared logic for the Annual Inspection (533) + Trap Check (504) auto-creation on exclusion completion.
import { FR_OFFICES } from './helcimBridge';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
export const ANNUAL_INSPECTION_SERVICE = '533';
export const TRAP_CHECK_SERVICE = '504';

// Map a selected guarantee group name -> { months, noExpiration }. Returns null for "no guarantee" / 12-month
// (no annual inspection needed) or unrecognized.
export function guaranteeToTerm(name: string): { months: number; noExpiration: boolean } | null {
  const n = (name || '').toLowerCase();
  if (/lifetime/.test(n)) return { months: 120, noExpiration: true };
  if (/10\s*[-\s]*year/.test(n)) return { months: 120, noExpiration: false };
  if (/5\s*[-\s]*year/.test(n)) return { months: 60, noExpiration: false };
  if (/3\s*[-\s]*year/.test(n)) return { months: 36, noExpiration: false }; // covers "Large Critter 3 Year" too
  return null; // "No Guarantee", "12 Month", or unknown -> no AI subscription
}

// Given the list of SELECTED guarantee group names, pick the ONE that represents the actual sold guarantee.
// PMs sometimes leave "12 Month" selected alongside a higher tier; we always take the HIGHEST tier present.
// Lifetime > 10yr > 5yr > 3yr > 12mo > none. Returns the chosen name + term, or null if only 12mo/none.
export function resolveGuarantee(selectedGuarantees: string[]): { name: string; term: { months: number; noExpiration: boolean } } | null {
  const ranked = selectedGuarantees
    .map(name => ({ name, term: guaranteeToTerm(name), rank: rankOf(name) }))
    .filter(x => x.rank > 0)
    .sort((a, b) => b.rank - a.rank);
  const top = ranked[0];
  if (!top || !top.term) return null;
  return { name: top.name, term: top.term };
}
function rankOf(name: string): number {
  const n = (name || '').toLowerCase();
  if (/lifetime/.test(n)) return 5;
  if (/10\s*[-\s]*year/.test(n)) return 4;
  if (/5\s*[-\s]*year/.test(n)) return 3;
  if (/3\s*[-\s]*year/.test(n)) return 2;
  if (/12\s*month/.test(n)) return 1; // present but not creatable
  return 0;
}

// Compute nextService (+1yr) and expirationDate (+term -1 day, or none) from the exclusion completion date.
export function computeDates(exclusionDate: string, term: { months: number; noExpiration: boolean }) {
  const d = new Date(exclusionDate.split(' ')[0] + 'T00:00:00Z');
  const next = new Date(d); next.setUTCFullYear(next.getUTCFullYear() + 1);
  const nextService = next.toISOString().slice(0, 10);
  let expirationDate: string | null = null;
  if (!term.noExpiration) {
    const exp = new Date(d); exp.setUTCMonth(exp.getUTCMonth() + term.months); exp.setUTCDate(exp.getUTCDate() - 1);
    expirationDate = exp.toISOString().slice(0, 10);
  }
  return { nextService, expirationDate };
}

function officeCfg(office: string) {
  const c = (FR_OFFICES as any)[office];
  if (!c?.key) throw new Error(`no FR creds for office ${office}`);
  return { auth: `authenticationKey=${c.key}&authenticationToken=${c.token}`, officeId: c.officeId };
}

export async function customerHasService(office: string, customerId: string, serviceId: string): Promise<boolean> {
  const { auth } = officeCfg(office);
  const ss = await fetch(`${FR_BASE}/subscription/search?${auth}&customerIDs=${customerId}`).then(r => r.json()).catch(() => null);
  const ids = ss?.subscriptionIDs || [];
  if (!ids.length) return false;
  const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${ids.join(',')}${ids.length === 1 ? ',' + ids[0] : ''}`).then(r => r.json()).catch(() => null);
  return (g?.subscriptions || []).some((s: any) => String(s.serviceID) === serviceId && String(s.active) === '1');
}

// Create the Annual Inspection (533) sub: CREATE then UPDATE (nextService forced to today on create).
export async function createAnnualInspection(office: string, p: {
  customerId: string; exclusionDate: string; term: { months: number; noExpiration: boolean }; soldBy?: string | null;
}): Promise<{ ok: boolean; subscriptionID: string | null; detail?: any }> {
  const { auth } = officeCfg(office);
  const { nextService, expirationDate } = computeDates(p.exclusionDate, p.term);
  const create: Record<string, string> = {
    customerID: p.customerId, serviceID: ANNUAL_INSPECTION_SERVICE, frequency: '360', followupService: '360',
    initialCharge: '149.00', recurringCharge: '149.00', agreementLength: String(p.term.months),
  };
  const cr = await fetch(`${FR_BASE}/subscription/create?${auth}&${new URLSearchParams(create)}`, { method: 'POST' }).then(r => r.json()).catch(() => null);
  if (!cr?.success) return { ok: false, subscriptionID: null, detail: cr };
  // find the newest 533 for this customer
  const ss = await fetch(`${FR_BASE}/subscription/search?${auth}&customerIDs=${p.customerId}`).then(r => r.json()).catch(() => null);
  const ids = ss?.subscriptionIDs || [];
  let newId: string | null = null;
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${ids.join(',')}${ids.length === 1 ? ',' + ids[0] : ''}`).then(r => r.json()).catch(() => null);
    const s533 = (g?.subscriptions || []).filter((s: any) => String(s.serviceID) === ANNUAL_INSPECTION_SERVICE).sort((a: any, b: any) => String(b.dateAdded).localeCompare(String(a.dateAdded)));
    newId = s533[0]?.subscriptionID || null;
  }
  if (!newId) return { ok: false, subscriptionID: null, detail: 'created but could not locate new sub' };
  const upd: Record<string, string> = { subscriptionID: newId, nextService, customDate: nextService, duration: '-1' };
  if (expirationDate) upd.expirationDate = expirationDate;
  if (p.soldBy) upd.soldBy = p.soldBy;
  await fetch(`${FR_BASE}/subscription/update?${auth}&${new URLSearchParams(upd)}`, { method: 'POST' }).catch(() => {});
  return { ok: true, subscriptionID: newId };
}

// Create a Trap Check (504): 5-day frequency.
export async function createTrapCheck(office: string, p: { customerId: string; soldBy?: string | null }): Promise<{ ok: boolean; subscriptionID: string | null; detail?: any }> {
  const { auth } = officeCfg(office);
  const create: Record<string, string> = {
    customerID: p.customerId, serviceID: TRAP_CHECK_SERVICE, frequency: '5', followupService: '5',
    initialCharge: '0.00', recurringCharge: '0.00', agreementLength: '12',
  };
  const cr = await fetch(`${FR_BASE}/subscription/create?${auth}&${new URLSearchParams(create)}`, { method: 'POST' }).then(r => r.json()).catch(() => null);
  if (!cr?.success) return { ok: false, subscriptionID: null, detail: cr };
  const ss = await fetch(`${FR_BASE}/subscription/search?${auth}&customerIDs=${p.customerId}`).then(r => r.json()).catch(() => null);
  const ids = ss?.subscriptionIDs || [];
  let newId: string | null = null;
  if (ids.length) {
    const g = await fetch(`${FR_BASE}/subscription/get?${auth}&subscriptionIDs=${ids.join(',')}${ids.length === 1 ? ',' + ids[0] : ''}`).then(r => r.json()).catch(() => null);
    const s504 = (g?.subscriptions || []).filter((s: any) => String(s.serviceID) === TRAP_CHECK_SERVICE).sort((a: any, b: any) => String(b.dateAdded).localeCompare(String(a.dateAdded)));
    newId = s504[0]?.subscriptionID || null;
  }
  if (newId && p.soldBy) await fetch(`${FR_BASE}/subscription/update?${auth}&subscriptionID=${newId}&soldBy=${p.soldBy}&duration=-1`, { method: 'POST' }).catch(() => {});
  return { ok: true, subscriptionID: newId };
}

// Resolve a PM full name to their FR employee ID within an office (for soldBy). Returns null if not found.
export async function pmNameToFrId(office: string, fullName: string): Promise<string | null> {
  if (!fullName) return null;
  const { auth, officeId } = officeCfg(office);
  const parts = fullName.trim().split(/\s+/);
  const fn = parts[0] || '', ln = parts.slice(1).join(' ') || '';
  const s = await fetch(`${FR_BASE}/employee/search?${auth}&officeIDs=${officeId}&fname=${encodeURIComponent(fn)}&lname=${encodeURIComponent(ln)}`).then(r => r.json()).catch(() => null);
  const ids = s?.employeeIDs || [];
  return ids.length ? String(ids[0]) : null;
}

// Live-fetch the selected guarantee group names + PM from SmarterLaunch for a customer_uuid.
// Fallback for when the stored estimate predates guarantee capture. Returns { guarantees, pm } or null.
export async function fetchGuaranteeFromSL(customerUuid: string): Promise<{ guarantees: string[]; pm: string | null } | null> {
  const KEY = process.env.SMARTERLAUNCH_API_KEY;
  if (!KEY || !customerUuid) return null;
  const SL = 'https://api.smarterlaunch.com/api/v1';
  const h = { 'X-API-Key': KEY, 'Accept': 'application/json' };
  try {
    const pr = await fetch(`${SL}/proposals?customer_uuid=${customerUuid}`, { headers: h }).then(r => r.json()).catch(() => null);
    const accepted = (pr?.data || []).find((p: any) => p.status?.status_code === 'PROPOSAL_ACCEPTED') || (pr?.data || [])[0];
    if (!accepted) return null;
    const det = await fetch(`${SL}/proposals/${accepted.uuid}`, { headers: h }).then(r => r.json()).catch(() => null);
    const d = det?.data || {};
    const gOpts: Record<string, string> = {};
    for (const pl of (d.proposal_template_data?.service_plans || [])) for (const g of (pl.service_plan_pricing_groups || [])) if (g.uuid && g.name && /guarantee|warranty/i.test(g.name)) gOpts[g.uuid] = g.name;
    const pv = d.latest_version?.proposal_values || {};
    const sel = (v: any) => v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0' && v.trim().toLowerCase() !== 'false');
    const selU: Record<string, any> = {};
    (function walk(o: any) { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (typeof k === 'string' && k.length === 36 && sel(v)) selU[k] = v; walk(v); } })(pv);
    const guarantees = Object.keys(selU).filter(u => gOpts[u]).map(u => gOpts[u]);
    const pm = d.user ? [d.user.first_name, d.user.last_name].filter(Boolean).join(' ').trim() : null;
    return { guarantees, pm };
  } catch { return null; }
}
