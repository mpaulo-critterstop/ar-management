import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

// Probe a tech's route for a day: appointments (address + check-in + GPS), clock-in, and first-site arrival.
// ?token=critterstop2026 &empId=10459 &date=2026-11-16
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const empId = sp.get('empId') || '10459';
  const date = sp.get('date') || '2026-11-16';
  const start = `${date} 00:00:00`, end = `${date} 23:59:59`;

  const out: any = { empId, date, offices: {} };

  for (const [office, cfg] of Object.entries(FR_OFFICES)) {
    if (!cfg.key || !cfg.token) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
    try {
      // confirm employee is in this office
      const empGet = await fetch(`${FR_BASE}/employee/get?employeeIDs=${empId}&${auth}`);
      const empJson = await empGet.json().catch(() => null);
      if (!empJson?.employees?.length) continue;
      const emp = empJson.employees[0];

      const officeOut: any = { employee: `${emp.fname} ${emp.lname}`, employeeID: emp.employeeID };

      // 1) Appointments for this employee on this date. Try several filter strategies (FR field names vary).
      const dayBetween = encodeURIComponent(JSON.stringify({ operator: 'BETWEEN', value: [`${date} 00:00:00`, `${date} 23:59:59`] }));
      const dEq = encodeURIComponent(JSON.stringify({ operator: '=', value: date }));
      const strategies = [
        `date=${dEq}&servicedBy=${empId}`,
        `date=${dayBetween}&servicedBy=${empId}`,
        `appointmentDate=${dEq}&servicedBy=${empId}`,
        `dateCompleted=${dayBetween}&servicedBy=${empId}`,
      ];
      let appts: any[] = []; let usedStrategy = null; const tried: any[] = [];
      for (const strat of strategies) {
        const r = await fetch(`${FR_BASE}/appointment/search?${strat}&includeData=1&${auth}`);
        const j = await r.json().catch(() => null);
        const ids = j?.appointmentIDs || [];
        tried.push({ strat: strat.split('&includeData')[0], count: j?.count ?? 0, ignored: j?.ignoredParams });
        if (ids.length) {
          let got = j?.appointments || [];
          if (!got.length) { const g = await fetch(`${FR_BASE}/appointment/get?appointmentIDs=${ids.slice(0,50).join(',')}&${auth}`); got = (await g.json().catch(()=>null))?.appointments || []; }
          // if we used the no-employee-filter strategy, keep only this employee's
          if (strat.startsWith('spawnTime=' + dayBetween) && !strat.includes('empId') && !strat.includes('servicedBy') && !strat.includes('assignedEmployee')) {
            got = got.filter((a: any) => String(a.servicedBy) === empId || String(a.assignedTech) === empId || String(a.employeeID) === empId);
          }
          if (got.length) { appts = got; usedStrategy = strat.split('&includeData')[0]; break; }
        }
      }
      officeOut.apptCount = appts.length;
      officeOut.usedStrategy = usedStrategy;
      officeOut.triedStrategies = tried;
      if (appts.length) officeOut.sampleApptKeys = Object.keys(appts[0]); 
      if (appts.length) officeOut.sampleAppt = { appointmentID: appts[0].appointmentID, date: appts[0].date, start: appts[0].start, servicedBy: appts[0].servicedBy, checkIn: appts[0].checkIn, customerID: appts[0].customerID };

      // For each appointment, pull customer address via customer/get
      const rows: any[] = [];
      for (const a of (Array.isArray(appts) ? appts : []).slice(0, 15)) {
        let address = null;
        if (a.customerID) {
          const c = await fetch(`${FR_BASE}/customer/get?customerIDs=${a.customerID}&${auth}`);
          const cj = await c.json().catch(() => null);
          const cust = cj?.customers?.[0];
          if (cust) address = [cust.address, cust.city, cust.state, cust.zip].filter(Boolean).join(', ');
        }
        rows.push({
          appointmentID: a.appointmentID, customerID: a.customerID, address,
          scheduled: a.start || a.spawnTime || a.date,
          checkIn: a.checkIn, checkOut: a.checkOut, timeIn: a.timeIn, timeOut: a.timeOut,
          latIn: a.latIn, longIn: a.longIn, dateCompleted: a.dateCompleted,
        });
      }
      // sort by actual arrival (checkIn/timeIn) then scheduled
      rows.sort((x, y) => String(x.checkIn || x.timeIn || x.scheduled || '').localeCompare(String(y.checkIn || y.timeIn || y.scheduled || '')));
      officeOut.appointments = rows;

      // 2) Clock-in for the day
      const tc = await fetch(`${FR_BASE}/timeClock/search?employeeIDs=${empId}&timeIn=${encodeURIComponent(JSON.stringify({ operator: 'BETWEEN', value: [start, end] }))}&includeData=1&${auth}`);
      const tcJson = await tc.json().catch(() => null);
      const clock = (tcJson?.timeClock || [])[0];
      officeOut.clockIn = clock?.timeIn || null;
      officeOut.tcRawCount = tcJson?.count; officeOut.tcKeys = tcJson ? Object.keys(tcJson) : null;
      officeOut.clockOut = clock?.timeOut || null;

      // GPS trail for the day (per-employee filtered)
      const locUrl = `${FR_BASE}/employeeLocation/search?employeeID=${encodeURIComponent(JSON.stringify({ operator: '=', value: empId }))}&time=${encodeURIComponent(JSON.stringify({ operator: 'BETWEEN', value: [start, end] }))}&includeData=1&${auth}`;
      const locR = await fetch(locUrl); const locJ = await locR.json().catch(() => null);
      let locs = locJ?.employeeLocations || locJ?.employeeLocation || [];
      if ((!locs || !locs.length) && (locJ?.employeeLocationIDs || []).length) {
        const lids = locJ.employeeLocationIDs.slice(0, 500).join(',');
        const lg = await fetch(`${FR_BASE}/employeeLocation/get?employeeLocationIDs=${lids}&${auth}`);
        locs = (await lg.json().catch(() => null))?.employeeLocations || [];
      }
      locs = locs.filter((l: any) => String(l.employeeID) === empId);
      locs.sort((a: any, b: any) => String(a.time).localeCompare(String(b.time)));
      officeOut.gpsCount = locs.length;
      officeOut.locRawCount = locJ?.count; officeOut.locKeys = locJ ? Object.keys(locJ) : null; officeOut.locIgnored = locJ?.ignoredParams;
      // first ~15 GPS points of the day (to see the office arrival)
      officeOut.allGps = locs.map((l: any) => ({ time: l.time, lat: l.latitude, lng: l.longitude }));

      // Check if clock punches have GPS at the exact punch time
      const allClocks = (tcJson?.timeClock || []).map((t: any) => ({ in: t.timeIn, out: t.timeOut }));
      const parse = (s: string) => new Date(String(s).replace(' ', 'T') + 'Z').getTime();
      const gpsAt = (target: string) => {
        if (!target) return null;
        const t = parse(target); let best: any = null, bestDiff = Infinity;
        for (const l of locs) { const dd = Math.abs(parse(l.time) - t); if (dd < bestDiff) { bestDiff = dd; best = l; } }
        return best ? { gpsTime: best.time, lat: best.latitude, lng: best.longitude, diffSeconds: Math.round(bestDiff / 1000) } : null;
      };
      officeOut.clockPunchGps = allClocks.map((c: any) => ({
        clockIn: c.in, gpsAtClockIn: gpsAt(c.in),
        clockOut: c.out, gpsAtClockOut: gpsAt(c.out),
      }));

      // 3) First site arrival = first appointment with a checkIn/timeIn
      const firstArrival = rows.find(r => r.checkIn || r.timeIn);
      officeOut.firstSiteArrival = firstArrival ? {
        address: firstArrival.address, arrivalTime: firstArrival.checkIn || firstArrival.timeIn,
        lat: firstArrival.latIn, lng: firstArrival.longIn,
      } : null;

      out.offices[office] = officeOut;
    } catch (e) {
      out.offices[office] = { error: String(e) };
    }
  }
  return NextResponse.json(out);
}
