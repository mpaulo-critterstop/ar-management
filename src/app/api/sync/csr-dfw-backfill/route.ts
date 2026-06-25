import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const DFW_KEY = process.env.FIELDROUTES_KEY_DFW!;
const DFW_TOKEN = process.env.FIELDROUTES_TOKEN_DFW!;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 500;

// DFW-specific wildlife IDs (645 is main, 544 and 619 are alternates)
const DFW_WILDLIFE_IDS = new Set(['645', '544', '619']);

async function frFetch(endpoint: string, params: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${DFW_KEY}&authenticationToken=${DFW_TOKEN}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchInBatches(ids: number[]): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE).join(',');
    const data = await frFetch('appointment/get', `appointmentIDs=${batch}`);
    if (data.success && data.appointments) results.push(...data.appointments);
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (token !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const log: string[] = [];

  // Fetch all DFW appointments from Jan 1 to May 27
  log.push('Fetching DFW appointments Jan 1 - May 27 2026...');
  const searchData = await frFetch('appointment/search', 'dateStart=2026-01-01&dateEnd=2026-05-27');
  const allIds: number[] = searchData.appointmentIDs || [];
  log.push(`Total appointment IDs: ${allIds.length}`);

  const appointments = await fetchInBatches(allIds);
  log.push(`Appointments fetched: ${appointments.length}`);

  // Filter for wildlife inspections, completed, before May 28
  const wildlife = appointments.filter((a: any) =>
    DFW_WILDLIFE_IDS.has(String(a.type)) &&
    a.status === '1' &&
    a.date && new Date(a.date) < new Date('2026-05-28')
  );
  log.push(`DFW wildlife inspections found: ${wildlife.length}`);

  let created = 0;
  let skipped = 0;

  for (const appt of wildlife) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "csr_appointments" (
          "id", "externalId", "office", "appointmentDate", "serviceTypeId",
          "serviceTypeName", "status", "originalAppointmentId", "employeeId",
          "customerId", "createdAt", "updatedAt"
        ) VALUES (
          ${'wild_dfw_' + appt.appointmentID},
          ${String(appt.appointmentID)},
          'DFW',
          ${appt.date ? new Date(appt.date) : null},
          ${String(appt.type)},
          'Wildlife Inspection',
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
      skipped++;
    }
  }

  log.push(`Created: ${created}, Skipped: ${skipped}`);

  return NextResponse.json({ status: 'done', created, skipped, log });
}
