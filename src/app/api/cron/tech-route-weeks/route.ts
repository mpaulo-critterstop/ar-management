// Tech route-appearance counts by WEEK (Mon-Sun), for cross-referencing against payroll hours.
// Purpose (Chisam/Lori data-integrity check): a tech who appears on 5 routes in a week but was only paid for
// 4 days (40hr) likely has a phantom route — added as additionalTech for access, or not removed after a call-out.
// A tech = on a route if they are assignedTech OR in additionalTechs.
//   GET ?token=critterstop2026&from=2026-08-01&to=2026-10-31[&office=DFW][&csv=1]
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

let chain: Promise<any> = Promise.resolve();
function fr(url: string): Promise<any> {
  const run = chain.then(async () => { await new Promise(r => setTimeout(r, 900)); return fetch(url).then(r => r.json()); });
  chain = run.catch(() => {});
  return run;
}

// Monday-start ISO week label for a yyyy-mm-dd date.
function weekOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day);
  return mon.toISOString().slice(0, 10); // the Monday
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const from = sp.get('from') || '2026-08-01';
  const to = sp.get('to') || '2026-10-31';
  const onlyOffice = sp.get('office');
  const offices = onlyOffice ? { [onlyOffice]: OFFICES[onlyOffice] } : OFFICES;

  // Resolve tech names once (reuse the employee list per office).
  const techName = new Map<string, string>();

  // tech -> week(Monday) -> { routeDays:Set<date>, routeCount:number, offices:Set, routes:[{id,date,role}] }
  type Cell = { routeDays: Set<string>; routeCount: number; offices: Set<string>; byType: Record<string, number> };
  const data = new Map<string, Map<string, Cell>>(); // techId -> weekMon -> Cell

  for (const [officeName, cfg] of Object.entries(offices)) {
    if (!cfg?.key) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

    // employee names
    try {
      const es = await fr(`${BASE_URL}/employee/search?${auth}&officeIDs=${cfg.officeId}`);
      const eids = es.employeeIDs || [];
      for (let i = 0; i < eids.length; i += 100) {
        const c = eids.slice(i, i + 100);
        const eg = await fr(`${BASE_URL}/employee/get?${auth}&employeeIDs=${c.join(',')}${c.length === 1 ? ',' + c[0] : ''}`);
        for (const e of (eg.employees || [])) techName.set(String(e.employeeID), `${e.fname || ''} ${e.lname || ''}`.trim() || String(e.employeeID));
      }
    } catch {}

    // routes in range
    const rs = await fr(`${BASE_URL}/route/search?officeIDs=${cfg.officeId}&dateStart=${from}&dateEnd=${to}&${auth}`);
    const rids = rs.routeIDs || [];
    for (let i = 0; i < rids.length; i += 100) {
      const c = rids.slice(i, i + 100);
      const rg = await fr(`${BASE_URL}/route/get?${auth}&routeIDs=${c.join(',')}${c.length === 1 ? ',' + c[0] : ''}`);
      for (const r of (rg.routes || [])) {
        const date = String(r.date || '').slice(0, 10);
        if (!date || date < from || date > to) continue;
        const wk = weekOf(date);
        const type = String(r.groupTitle || r.title || 'Other').replace(/ Routes?$/i, '');
        const crew = new Set<string>();
        if (r.assignedTech && String(r.assignedTech) !== '0') crew.add(String(r.assignedTech));
        if (r.additionalTechs) String(r.additionalTechs).split(',').map((x: string) => x.trim()).filter(Boolean).forEach((t: string) => crew.add(t));
        for (const tech of crew) {
          let wkMap = data.get(tech); if (!wkMap) { wkMap = new Map(); data.set(tech, wkMap); }
          let cell = wkMap.get(wk); if (!cell) { cell = { routeDays: new Set(), routeCount: 0, offices: new Set(), byType: {} }; wkMap.set(wk, cell); }
          cell.routeCount++;
          cell.routeDays.add(date);
          cell.offices.add(officeName);
          cell.byType[type] = (cell.byType[type] || 0) + 1;
        }
      }
    }
  }

  // Flatten to rows: one row per tech per week.
  const rows: any[] = [];
  for (const [tech, wkMap] of data) {
    for (const [wk, cell] of wkMap) {
      rows.push({
        tech: techName.get(tech) || `FR ${tech}`,
        techId: tech,
        weekStart: wk,
        routeCount: cell.routeCount,        // total route appearances that week
        distinctDays: cell.routeDays.size,  // distinct calendar days on a route
        offices: [...cell.offices].join('/'),
        types: cell.byType,
        // flag: more route-appearances than distinct days = double-booked that day (overlap signal)
        overlapFlag: cell.routeCount > cell.routeDays.size,
        // flag: 5+ route-days in a Mon-Sun week (techs work 10hrx4 = 4 days; 5+ suggests OT or a phantom)
        over4DaysFlag: cell.routeDays.size >= 5,
      });
    }
  }
  rows.sort((a, b) => a.tech.localeCompare(b.tech) || a.weekStart.localeCompare(b.weekStart));

  if (sp.get('csv') === '1') {
    const header = 'Technician,Tech ID,Week (Mon),Route Appearances,Distinct Days,Offices,Overlap (appts>days),5+ Days,Route Types';
    const lines = rows.map(r => [r.tech, r.techId, r.weekStart, r.routeCount, r.distinctDays, r.offices,
      r.overlapFlag ? 'YES' : '', r.over4DaysFlag ? 'YES' : '',
      `"${Object.entries(r.types).map(([k, v]) => `${k}:${v}`).join('; ')}"`].join(','));
    return new NextResponse([header, ...lines].join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="tech_route_weeks_${from}_${to}.csv"` } });
  }

  return NextResponse.json({
    from, to, offices: Object.keys(offices),
    techWeeks: rows.length,
    flaggedOverlap: rows.filter(r => r.overlapFlag).length,
    flagged5plusDays: rows.filter(r => r.over4DaysFlag).length,
    rows,
  });
}
