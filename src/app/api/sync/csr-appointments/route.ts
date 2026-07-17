import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const OFFICES: Record<string, { key: string; token: string }> = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

// All service type IDs that count as CSR-bookable inspections/leads, across ALL offices.
// DFW IDs are global; ATX/OKC/CStat have office-specific IDs (being migrated to global, but
// historical appointments were booked under the office-specific ones, so all are included).
// Wildlife Inspection is now sourced here from FR appointments (645/1037/722/884) — the old
// Lead-table wildlife source has been removed to keep everything in one place.
const CSR_SERVICE_IDS = new Set([
  // Bed Bug Inspection
  '676', '833',
  // Bird Inspection
  '719',
  // Commercial Pest Control - Inspection
  '514',
  // DAR - Lead
  '619', '715',
  // Insulation Inspection
  '544', '832',
  // MistAway System Lead
  '642', '885',
  // Mosquito Lead
  '640', '744',
  // Pest Control - Lead
  '672', '748',
  // Pest Control Inspection
  '608', '1030', '749',
  // Pest Inspection
  '294', '133', '839',
  // Residential Pest Control - Inspection
  '612',
  // Termite Inspection
  '508', '1024', '845',
  // WDI Inspection
  '681', '1038',
  // Wildlife Inspection
  '645', '1037', '722', '884',
]);

const SERVICE_NAMES: Record<string, string> = {
  '676': 'Bed Bug Inspection', '833': 'Bed Bug Inspection',
  '719': 'Bird Inspection',
  '514': 'Commercial Pest Control - Inspection',
  '619': 'DAR - Lead', '715': 'DAR - Lead',
  '544': 'Insulation Inspection', '832': 'Insulation Inspection',
  '642': 'MistAway System Lead', '885': 'MistAway System Lead',
  '640': 'Mosquito Lead', '744': 'Mosquito Lead',
  '672': 'Pest Control - Lead', '748': 'Pest Control - Lead',
  '608': 'Pest Control Inspection', '1030': 'Pest Control Inspection', '749': 'Pest Control Inspection',
  '294': 'Pest Inspection', '133': 'Pest Inspection', '839': 'Pest Inspection',
  '612': 'Residential Pest Control - Inspection',
  '508': 'Termite Inspection', '1024': 'Termite Inspection', '845': 'Termite Inspection',
  '681': 'WDI Inspection', '1038': 'WDI Inspection',
  '645': 'Wildlife Inspection', '1037': 'Wildlife Inspection', '722': 'Wildlife Inspection', '884': 'Wildlife Inspection',
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

  // NOTE: Wildlife inspections are now sourced directly from FR appointments via their service
  // type IDs (645/1037/722/884), included in CSR_SERVICE_IDS above. The previous Lead-table
  // wildlife source was removed to keep everything in one place and avoid double-counting.

  return NextResponse.json({ status: 'done', totalCreated, log });
}
