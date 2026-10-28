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
const MATCH_TOLERANCE_HRS = 1; // within ±1hr of estimate = "matched"

let chain: Promise<any> = Promise.resolve();
function fr(url: string): Promise<any> {
  const run = chain.then(async () => { await new Promise(r => setTimeout(r, 1400)); return fetch(url).then(r => r.json()); });
  chain = run.catch(() => {});
  return run;
}
const spanHrs = (st: string, en: string) => { const [sh, sm] = st.split(':').map(Number); const [eh, em] = en.split(':').map(Number); return ((eh * 60 + em) - (sh * 60 + sm)) / 60; };

// Find the customer's completed/scheduled exclusion appointment across offices; return booked hours (Option B) or null.
async function bookedHoursForCustomer(frId: string): Promise<{ bookedHours: number | null; office: string | null; apptDate: string | null }> {
  for (const [officeName, cfg] of Object.entries(OFFICES)) {
    if (!cfg.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    const s = await fr(`${BASE_URL}/appointment/search?${auth}&customerIDs=${frId}`);
    const ids = (s.appointmentIDs || []);
    if (!ids.length) continue;
    const g = await fr(`${BASE_URL}/appointment/get?${auth}&appointmentIDs=${ids.join(',')}${ids.length === 1 ? ',' + ids[0] : ''}`);
    const excl = (g.appointments || []).filter((a: any) => String(a.type) === String(EXCLUSION_TYPE));
    if (!excl.length) continue;
    // Prefer the soonest/active exclusion appointment.
    const a = excl[0];
    const dur = parseInt(String(a.duration || '0')) || 0;
    let bookedMin = dur;
    if (dur >= 480) {
      // Option B: check the route for blocked spots + other appts.
      const rid = String(a.routeID);
      if (rid && rid !== '0') {
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
    return { bookedHours: Math.round((bookedMin / 60) * 100) / 100, office: officeName, apptDate: String(a.date || '').slice(0, 10) };
  }
  return { bookedHours: null, office: null, apptDate: null };
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

  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
  const results: any[] = [];
  for (const row of rows) {
    let rec: any; try { rec = JSON.parse(row.value); } catch { continue; }
    if (oneFr && String(rec.frCustomerId) !== String(oneFr)) continue;
    // Only (re)check ones that are still pending, unless a specific frId is forced.
    if (!oneFr && rec.schedulingNote && !String(rec.schedulingNote).toLowerCase().includes('pending')) continue;
    if (!rec.frCustomerId) { results.push({ frId: null, status: 'skipped (no FR id)' }); continue; }

    const estimatedHours = rec.estimate?.totalHours ?? null;
    const { bookedHours, office, apptDate } = await bookedHoursForCustomer(String(rec.frCustomerId));
    const note = statusNote(estimatedHours, bookedHours);
    rec.bookedHours = bookedHours;
    rec.bookedOffice = office;
    rec.apptDate = apptDate;
    rec.schedulingNote = note;
    rec.status = bookedHours == null ? 'PENDING_SCHEDULE' : 'SCHEDULED';
    rec.lastChecked = new Date().toISOString();
    await prisma.appSetting.update({ where: { key: row.key }, data: { value: JSON.stringify(rec) } });
    results.push({ frId: rec.frCustomerId, estimatedHours, bookedHours, note });
  }
  return NextResponse.json({ checked: results.length, results });
}
