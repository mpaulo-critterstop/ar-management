// STEP 3: FR booking comparison for exclusion estimates.
// For each stored estimate (or one customer), look up the customer's exclusion (553) appointment in FR,
// compute the booked duration (Option B: 480 + blocked spots, else solo-route -> 600, else as-is),
// compare to the estimate, and set the scheduling status note.
//   GET ?token=critterstop2026            -> re-check all PENDING estimates (the daily cron path)
//   GET ?token=critterstop2026&frId=11440 -> re-check one customer
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};
const EXCLUSION_TYPE = 553;
const MATCH_TOLERANCE_HRS = 0.5; // within ±0.5hr of estimate = "matched"

let chain: Promise<any> = Promise.resolve();
function fr(url: string): Promise<any> {
  const run = chain.then(async () => { await new Promise(r => setTimeout(r, 1400)); return fetch(url).then(r => r.json()); });
  chain = run.catch(() => {});
  return run;
}
const spanHrs = (st: string, en: string) => { const [sh, sm] = st.split(':').map(Number); const [eh, em] = en.split(':').map(Number); return ((eh * 60 + em) - (sh * 60 + sm)) / 60; };

const OFFICE_BY_ID: Record<string, string> = { '1': 'DFW', '5': 'ATX', '3': 'OKC', '4': 'CStat' };

// Find the customer's completed/scheduled exclusion appointment; return booked hours (Option B) or null.
// officeHint (from the FR webhook's officeID) is tried first to avoid searching all offices.
async function bookedHoursForCustomer(frId: string, officeHint?: string): Promise<{ bookedHours: number | null; bookedWallClockHours?: number | null; crewSize?: number; office: string | null; apptDate: string | null }> {
  const hintedOffice = officeHint ? OFFICE_BY_ID[String(officeHint)] : null;
  const orderedOffices = hintedOffice
    ? [[hintedOffice, OFFICES[hintedOffice]], ...Object.entries(OFFICES).filter(([n]) => n !== hintedOffice)] as [string, any][]
    : Object.entries(OFFICES);
  for (const [officeName, cfg] of orderedOffices) {
    if (!cfg.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const s = await fr(`${BASE_URL}/appointment/search?${auth}&customerIDs=${frId}`);
    const ids = (s.appointmentIDs || []);
    if (!ids.length) continue;
    const g = await fr(`${BASE_URL}/appointment/get?${auth}&appointmentIDs=${ids.join(',')}${ids.length === 1 ? ',' + ids[0] : ''}`);
    // Only TODAY-or-future exclusion appointments — the newly-booked job, not a past/original exclusion.
    // (An existing customer may have an old exclusion on file; we must not match that.)
    const today = new Date().toISOString().slice(0, 10);
    const excl = (g.appointments || [])
      .filter((a: any) => String(a.type) === String(EXCLUSION_TYPE))
      .filter((a: any) => String(a.date || a.dateAdded || '').slice(0, 10) >= today)
      .sort((x: any, y: any) => String(x.date || '').localeCompare(String(y.date || '')));
    if (!excl.length) continue;
    // The soonest upcoming exclusion appointment = the one just booked.
    const a = excl[0];
    const dur = parseInt(String(a.duration || '0')) || 0;
    let bookedMin = dur;               // wall-clock minutes the appointment is booked for
    let crewSize = 1;
    const rid = String(a.routeID);
    if (rid && rid !== '0') {
      // Crew lives on the ROUTE (route.additionalTechs + assignedTech), not the appointment.
      const rg = await fr(`${BASE_URL}/route/get?${auth}&routeIDs=${rid},${rid}`);
      const r = (rg.routes || [])[0];
      if (r) {
        const addl = r.additionalTechs ? String(r.additionalTechs).split(',').map((x: string) => x.trim()).filter(Boolean) : [];
        const crew = [...new Set([String(r.assignedTech), ...addl].filter(x => x && x !== '0'))];
        crewSize = Math.max(crew.length, 1);
      }
      // Option B: uncap 480 using blocked spots / solo-route assumption.
      if (dur >= 480) {
        const ss = await fr(`${BASE_URL}/spot/search?routeIDs=${rid}&blockReason=Blocked&${auth}`);
        const spotIds = ss.spotIDs || [];
        let blockedMin = 0;
        if (spotIds.length) {
          const sg = await fr(`${BASE_URL}/spot/get?${auth}&spotIDs=${spotIds.join(',')}${spotIds.length === 1 ? ',' + spotIds[0] : ''}`);
          for (const sp of (sg.spots || [])) { const br = sp.blockReason; if (br && String(br) !== '0' && br !== 0) blockedMin += 30; }
        }
        if (blockedMin > 0) bookedMin = 480 + blockedMin;
        else {
          const as = await fr(`${BASE_URL}/appointment/search?routeIDs=${rid}&${auth}`);
          bookedMin = (as.appointmentIDs || []).length <= 1 ? 600 : 480;
        }
      }
    }
    // Booked TECH-hours = wall-clock duration × crew size (the estimate is total labor hours, so compare like-for-like).
    const bookedTechMin = bookedMin * crewSize;
    return { bookedHours: Math.round((bookedTechMin / 60) * 100) / 100, bookedWallClockHours: Math.round((bookedMin / 60) * 100) / 100, crewSize, office: officeName, apptDate: String(a.date || '').slice(0, 10) };
  }
  return { bookedHours: null, bookedWallClockHours: null, crewSize: 0, office: null, apptDate: null };
}

function statusNote(estimatedHours: number | null, bookedHours: number | null): string {
  if (bookedHours == null) return 'Pending scheduling appointment';
  if (estimatedHours == null) return `Booked ${bookedHours}h (no estimate)`;
  const diff = bookedHours - estimatedHours;
  if (Math.abs(diff) <= MATCH_TOLERANCE_HRS) return 'Appointment duration matched estimate';
  return diff > 0 ? 'Booked appointment is over-allotted' : 'Booked appointment is under-allotted';
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const oneFr = sp.get('frId');
  const officeHint = sp.get('officeID') || undefined;

  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
  const results: any[] = [];
  for (const row of rows) {
    let rec: any; try { rec = JSON.parse(row.value); } catch { continue; }
    if (oneFr && String(rec.frCustomerId) !== String(oneFr)) continue;
    // Only (re)check ones that are still pending, unless a specific frId is forced.
    if (!oneFr && rec.schedulingNote && !String(rec.schedulingNote).toLowerCase().includes('pending')) continue;
    if (!rec.frCustomerId) { results.push({ frId: null, status: 'skipped (no FR id)' }); continue; }

    // Self-heal: if the stored estimate is missing the customer name, re-run the estimator to refresh it.
    if (rec.customerUuid && (!rec.estimate || !rec.estimate.customer)) {
      try {
        const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://hub.critterstop.com';
        const fresh = await fetch(`${base}/api/exclusion-estimator?token=critterstop2026&customer_uuid=${rec.customerUuid}`).then(r => r.json()).catch(() => null);
        if (fresh && !fresh.error) rec.estimate = fresh;
      } catch {}
    }
    const estimatedHours = rec.estimate?.totalHours ?? null;
    const { bookedHours, bookedWallClockHours, crewSize, office, apptDate } = await bookedHoursForCustomer(String(rec.frCustomerId), officeHint);
    const note = statusNote(estimatedHours, bookedHours);
    rec.bookedHours = bookedHours;            // tech-hours (wall-clock × crew)
    rec.bookedWallClockHours = bookedWallClockHours;
    rec.crewSize = crewSize;
    rec.bookedOffice = office;
    rec.apptDate = apptDate;
    rec.schedulingNote = note;
    rec.status = bookedHours == null ? 'PENDING_SCHEDULE' : 'SCHEDULED';
    rec.lastChecked = new Date().toISOString();
    await prisma.appSetting.update({ where: { key: row.key }, data: { value: JSON.stringify(rec) } });
    results.push({ frId: rec.frCustomerId, estimatedHours, bookedHours, bookedWallClockHours, crewSize, note });
  }
  return NextResponse.json({ checked: results.length, results });
}
