import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const OFFICES: Record<string, { key: string; token: string }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

const CSR_SERVICE_IDS = new Set([
  '676', '719', '514', '642', '640', '672', '608', '294', '612', '508', '845', '681',
]);

const SERVICE_NAMES: Record<string, string> = {
  '676': 'Bed Bug Inspection',
  '719': 'Bird Inspection',
  '514': 'Commercial Pest Control - Inspection',
  '642': 'MistAway System Lead',
  '640': 'Mosquito Lead',
  '672': 'Pest Control - Lead',
  '608': 'Pest Control Inspection',
  '294': 'Pest Inspection',
  '612': 'Residential Pest Control - Inspection',
  '508': 'Termite Inspection',
  '845': 'Termite Inspection',
  '681': 'WDI Inspection',
};

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 500;

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchInBatches(ids: number[], key: string, token: string): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE).join(',');
    const data = await frFetch('appointment/get', `appointmentIDs=${batch}`, key, token);
    if (data.success && data.appointments) results.push(...data.appointments);
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (token !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const officeParam = req.nextUrl.searchParams.get('office');
  const offices = officeParam ? [officeParam] : Object.keys(OFFICES);

  const log: string[] = [];
  let totalCreated = 0;

  for (const officeKey of offices) {
    const office = OFFICES[officeKey];
    if (!office) continue;

    log.push(`[${officeKey}] Fetching appointments...`);
    const searchData = await frFetch('appointment/search', 'dateStart=2026-01-01', office.key, office.token);
    const allIds: number[] = searchData.appointmentIDs || [];
    log.push(`[${officeKey}] Total IDs: ${allIds.length}`);

    const appointments = await fetchInBatches(allIds, office.key, office.token);
    const csrAppts = appointments.filter((a: any) =>
      CSR_SERVICE_IDS.has(String(a.type)) && a.status === '1'
    );
    log.push(`[${officeKey}] CSR appointments: ${csrAppts.length}`);

    let created = 0;
    for (const appt of csrAppts) {
      try {
        const id = `csr_appt_${appt.appointmentID}`;
        await prisma.$executeRaw`
          INSERT INTO "csr_appointments" (
            "id", "externalId", "office", "appointmentDate", "serviceTypeId",
            "serviceTypeName", "status", "originalAppointmentId", "employeeId",
            "customerId", "createdAt", "updatedAt"
          ) VALUES (
            ${id},
            ${String(appt.appointmentID)},
            ${officeKey},
            ${appt.date ? new Date(appt.date) : null},
            ${String(appt.type)},
            ${SERVICE_NAMES[String(appt.type)] || 'Unknown'},
            'COMPLETED',
            ${String(appt.originalAppointmentID || appt.appointmentID)},
            ${String(appt.employeeID || '0')},
            ${String(appt.customerID || '')},
            NOW(),
            NOW()
          )
          ON CONFLICT ("externalId") DO NOTHING
        `;
        created++;
      } catch (e: any) {
        log.push(`Error ${appt.appointmentID}: ${e.message}`);
      }
    }
    totalCreated += created;
    log.push(`[${officeKey}] Created: ${created}`);
  }

  // Sync new wildlife leads from Lead table
  await prisma.$executeRaw`
    INSERT INTO "csr_appointments" ("id", "externalId", "office", "appointmentDate", "serviceTypeId", "serviceTypeName", "status", "originalAppointmentId", "employeeId", "customerId", "createdAt", "updatedAt")
    SELECT
      'wild_' || l."externalId",
      l."externalId",
      l.office,
      l."inspectionDate",
      'wildlife',
      'Wildlife Inspection',
      l.status,
      COALESCE(l."groupId", l."externalId"),
      '',
      l."customerId",
      NOW(),
      NOW()
    FROM "Lead" l
    WHERE l."externalId" NOT LIKE 'csv_%'
    ON CONFLICT ("externalId") DO NOTHING
  `;

  log.push('Wildlife sync from Lead table complete');

  return NextResponse.json({ status: 'done', totalCreated, log });
}
