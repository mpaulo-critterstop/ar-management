import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';

export const dynamic = 'force-dynamic';
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

// Probe Tyler Rose's clock in/out + GPS for a given date (default 2026-11-03).
// ?token=critterstop2026 &name=Tyler Rose &date=2026-11-03
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const name = (sp.get('name') || 'Tyler Rose').trim();
  const date = sp.get('date') || '2026-11-03';
  const [fn, ...rest] = name.split(' ');
  const ln = rest.join(' ');

  const out: any = { name, date, offices: {} };

  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!cfg.key || !cfg.token) { out.offices[office] = { error: 'no creds' }; continue; }
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    try {
      // 1) find the employee by name
      const empSearch = await fetch(`${FR_BASE}/employee/search?officeIDs=${cfg.officeId}&fname=${encodeURIComponent(fn)}&lname=${encodeURIComponent(ln)}&${auth}`);
      const empJson = await empSearch.json().catch(() => null);
      const empIds: any[] = empJson?.employeeIDs || empJson?.employeeIDsNoDataExported || [];
      if (!empIds.length) { out.offices[office] = { found: false }; continue; }

      // 2) get full employee record(s)
      const empGet = await fetch(`${FR_BASE}/employee/get?employeeIDs=${empIds.join(',')}&${auth}`);
      const empData = await empGet.json().catch(() => null);
      const emps = empData?.employees || [];

      // date window (server is Pacific; use a wide UTC window for the day)
      const start = `${date} 00:00:00`;
      const end = `${date} 23:59:59`;

      const officeOut: any = { found: true, employeeIDs: empIds, employees: emps.map((e: any) => ({ id: e.employeeID, name: `${e.fname} ${e.lname}`, clockUser: e.clockUser ?? e.userName ?? null })) };

      // 3) time clock for the day
      const tcSearch = await fetch(`${FR_BASE}/timeClock/search?employeeIDs=${empIds.join(',')}&timeIn=${encodeURIComponent(JSON.stringify({ operator: 'BETWEEN', value: [start, end] }))}&includeData=1&${auth}`);
      const tcJson = await tcSearch.json().catch(() => null);
      officeOut.timeClockRaw = tcJson?.error ? tcJson : undefined;
      const tc = tcJson?.timeClock || tcJson?.timeClocks || [];
      officeOut.timeClock = Array.isArray(tc) ? tc.map((t: any) => ({ in: t.timeIn, out: t.timeOut, category: t.clockCategoryID, paid: t.paid })) : tc;

      // 4) GPS locations for the day
      const locSearch = await fetch(`${FR_BASE}/employeeLocation/search?employeeIDs=${empIds.join(',')}&time=${encodeURIComponent(JSON.stringify({ operator: 'BETWEEN', value: [start, end] }))}&includeData=1&${auth}`);
      const locJson = await locSearch.json().catch(() => null);
      officeOut.locationRaw = locJson?.error ? locJson : undefined;
      const locs = locJson?.employeeLocation || locJson?.employeeLocations || [];
      officeOut.locationCount = Array.isArray(locs) ? locs.length : 0;
      officeOut.locations = Array.isArray(locs) ? locs.slice(0, 40).map((l: any) => ({ time: l.time, lat: l.latitude, lng: l.longitude })) : locs;

      out.offices[office] = officeOut;
    } catch (e) {
      out.offices[office] = { error: String(e) };
    }
  }
  return NextResponse.json(out);
}
