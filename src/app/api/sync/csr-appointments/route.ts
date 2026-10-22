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
            "servicedBy", "customerId", "createdAt", "updatedAt"
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
            ${appt.servicedBy && String(appt.servicedBy) !== '0' ? String(appt.servicedBy) : null},
            ${String(appt.customerID || '')},
            NOW(),
            NOW()
          )
          ON CONFLICT ("externalId") DO UPDATE SET
            "servicedBy" = EXCLUDED."servicedBy",
            "updatedAt" = NOW()
        `;
        created++;
      } catch (e: any) {
        log.push(`Error ${appt.appointmentID}: ${e.message}`);
      }
    }
    totalCreated += created;
    log.push(`[${officeKey}] Created: ${created}`);

    // RECONCILE GHOSTS: csr_appointments is insert/update-only, so an appt that was status=1 when first synced
    // but later changed to No-Show/cancelled lingered as 'COMPLETED' and kept showing on the Leads Tracker as
    // "Inspected" (e.g. appt 223414, cust 52188 Misty Connelly: now FR status=2 'No Show'). FR's appointment
    // SEARCH does NOT return No-Show appts at all, so we can't spot them in the fetched set. Instead: take the
    // Hub records that are NO LONGER in the current completed-search set, re-verify each one's LIVE status via
    // appointment/get, and delete any that aren't status=1 (No-Show/cancelled/gone).
    const completedIds = new Set(allIds.map(String));
    const hubRows = await prisma.$queryRawUnsafe(
      `SELECT "externalId" FROM "csr_appointments" WHERE office = $1`, officeKey
    ) as { externalId: string }[];
    const missingFromSearch = hubRows.map(r => String(r.externalId)).filter(id => !completedIds.has(id));
    const ghostCsrIds: string[] = [];
    for (let k = 0; k < missingFromSearch.length; k += 100) {
      const batch = missingFromSearch.slice(k, k + 100);
      const g = await frFetch('appointment/get', `appointmentIDs=${batch.length === 1 ? `${batch[0]},${batch[0]}` : batch.join(',')}`, office.key, office.token);
      const live = new Map<string, string>();
      for (const a of (g?.appointments || [])) live.set(String(a.appointmentID), String(a.status));
      for (const id of batch) {
        const st = live.get(id); // undefined = deleted; '2'/'3'.. = No-Show/cancelled; only '1' is a real inspection
        if (st !== '1') ghostCsrIds.push(id);
      }
    }
    if (ghostCsrIds.length) {
      const rowIds = ghostCsrIds.map(id => `csr_appt_${id}`);
      await prisma.$executeRawUnsafe(`DELETE FROM "csr_leads" WHERE "leadId" = ANY($1)`, rowIds).catch(() => {});
      const del = await prisma.$executeRawUnsafe(`DELETE FROM "csr_appointments" WHERE "externalId" = ANY($1) AND office = $2`, ghostCsrIds, officeKey).catch(() => 0);
      log.push(`[${officeKey}] Ghosts removed (No-Show/cancelled/deleted since sync): ${del} (checked ${missingFromSearch.length} missing-from-search)`);
    } else {
      log.push(`[${officeKey}] No ghosts (checked ${missingFromSearch.length} missing-from-search)`);
    }
  }

  // NOTE: Wildlife inspections are now sourced directly from FR appointments via their service
  // type IDs (645/1037/722/884), included in CSR_SERVICE_IDS above. The previous Lead-table
  // wildlife source was removed to keep everything in one place and avoid double-counting.

  return NextResponse.json({ status: 'done', totalCreated, log });
}
