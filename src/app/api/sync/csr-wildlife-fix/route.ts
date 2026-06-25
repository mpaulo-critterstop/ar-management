import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const FR_OFFICES = [
  { key: 'DFW', apiKey: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW! },
  { key: 'ATX', apiKey: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX! },
  { key: 'OKC', apiKey: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC! },
  { key: 'CStat', apiKey: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
];

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?authenticationKey=${key}&authenticationToken=${token}&${params}`;
  const res = await fetch(url);
  return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (token !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');
  const limit = 50;

  // Get all wildlife records with null employeeId
  const allNulls = await prisma.$queryRaw<any[]>`
    SELECT id, "externalId", office
    FROM "csr_appointments"
    WHERE "serviceTypeId" = 'wildlife'
    AND ("employeeId" IS NULL OR "employeeId" = '')
    ORDER BY "appointmentDate" ASC
  `;

  const total = allNulls.length;
  const batch = allNulls.slice(0, limit); // always process first N remaining

  // Group by office
  const byOffice: Record<string, any[]> = {};
  for (const appt of batch) {
    if (!byOffice[appt.office]) byOffice[appt.office] = [];
    byOffice[appt.office].push(appt);
  }

  let updated = 0;
  let errors = 0;

  for (const [officeKey, appts] of Object.entries(byOffice)) {
    const office = FR_OFFICES.find(o => o.key === officeKey);
    if (!office) continue;

    const ids = appts.map((a: any) => a.externalId).join(',');
    const data = await frFetch('appointment/get', `appointmentIDs=${ids}`, office.apiKey, office.token);
    await sleep(1100);

    for (const frAppt of (data.appointments || [])) {
      const employeeId = String(frAppt.employeeID || '0');
      const originalApptId = String(frAppt.originalAppointmentID || frAppt.appointmentID);

      try {
        await prisma.$executeRaw`
          UPDATE "csr_appointments"
          SET "employeeId" = ${employeeId},
              "originalAppointmentId" = ${originalApptId},
              "updatedAt" = NOW()
          WHERE "externalId" = ${String(frAppt.appointmentID)}
          AND "serviceTypeId" = 'wildlife'
        `;
        updated++;
      } catch (e: any) {
        errors++;
      }
    }
  }

  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return NextResponse.json({
    status: hasMore ? 'in_progress' : 'done',
    total,
    offset,
    updated,
    errors,
    hasMore,
    nextUrl: hasMore ? `/api/sync/csr-wildlife-fix?token=critterstop2026&offset=0` : null,
  });
}
