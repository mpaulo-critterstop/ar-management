// READ-ONLY probe: given an appointment ID (a pest/termite inspection), show the full raw FR appointment
// AND resolve its employee fields to names — so we can see exactly how the inspecting PM is identified.
//   /api/cron/fr-inspection-probe?token=critterstop2026&office=DFW&appt=123456
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const OFFICES: Record<string, { key: string; token: string }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};
async function frGet(ep: string, params: string, key: string, token: string) {
  const r = await fetch(`${FR_BASE}/${ep}?${params}&authenticationKey=${key}&authenticationToken=${token}`);
  return r.json();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const office = sp.get('office') || 'DFW';
  const appt = sp.get('appt');
  const cfg = OFFICES[office];
  if (!cfg?.key || !appt) return NextResponse.json({ error: 'need office + appt' }, { status: 400 });

  // Raw appointment
  const ar = await frGet('appointment/get', `appointmentIDs=${appt},${appt}`, cfg.key, cfg.token);
  const a = (ar?.appointments || [])[0];
  if (!a) return NextResponse.json({ error: 'appointment not found', raw: ar });

  // Collect every employee-ID-looking field on the appointment, resolve each to a name.
  const empFields: Record<string, any> = {
    employeeID: a.employeeID, servicedBy: a.servicedBy, completedBy: a.completedBy,
    assignedTech: a.assignedTech, soldBy: a.soldBy, additionalTechs: a.additionalTechs,
  };
  const ids = new Set<string>();
  for (const v of Object.values(empFields)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach(x => x && String(x) !== '0' && ids.add(String(x)));
    else if (String(v) !== '0') ids.add(String(v));
  }
  const empNames: Record<string, string> = {};
  if (ids.size) {
    const er = await frGet('employee/get', `employeeIDs=${[...ids].join(',')}`, cfg.key, cfg.token);
    for (const e of (er?.employees || [])) empNames[String(e.employeeID)] = `${e.fname || ''} ${e.lname || ''}`.trim();
  }

  return NextResponse.json({
    office, appointmentID: appt,
    key_fields: {
      type: a.type, date: a.date, dateCompleted: a.dateCompleted, status: a.status, statusText: a.statusText,
      customerID: a.customerID, subscriptionID: a.subscriptionID, ticketID: a.ticketID,
    },
    employee_fields_raw: empFields,
    employee_fields_resolved: Object.fromEntries(
      Object.entries(empFields).map(([k, v]) => {
        if (Array.isArray(v)) return [k, v.map((x: any) => ({ id: x, name: empNames[String(x)] || null }))];
        return [k, { id: v, name: empNames[String(v)] || null }];
      })
    ),
    full_raw: a,
  });
}
