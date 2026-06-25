import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const DFW_KEY = process.env.FIELDROUTES_KEY_DFW!;
const DFW_TOKEN = process.env.FIELDROUTES_TOKEN_DFW!;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';
const BATCH_SIZE = 500;
const PROCESS_LIMIT = 50; // appointments to process per call

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

// Cache all wildlife appointment IDs in DB to avoid re-fetching from FR every call
async function getOrCacheWildlifeIds(): Promise<number[]> {
  // Use a temp key in app_settings to cache the filtered IDs
  const cached = await prisma.appSetting.findUnique({ where: { key: 'csr_dfw_backfill_ids' } });
  if (cached?.value) {
    return JSON.parse(cached.value);
  }

  // First time — fetch all and cache
  const searchData = await frFetch('appointment/search', 'dateStart=2026-01-01&dateEnd=2026-05-27');
  const allIds: number[] = searchData.appointmentIDs || [];
  const appointments = await fetchInBatches(allIds);

  const wildlifeIds = appointments
    .filter((a: any) =>
      DFW_WILDLIFE_IDS.has(String(a.type)) &&
      a.status === '1' &&
      a.date && new Date(a.date) < new Date('2026-05-28')
    )
    .map((a: any) => Number(a.appointmentID));

  await prisma.appSetting.upsert({
    where: { key: 'csr_dfw_backfill_ids' },
    create: { key: 'csr_dfw_backfill_ids', value: JSON.stringify(wildlifeIds) },
    update: { value: JSON.stringify(wildlifeIds) },
  });

  return wildlifeIds;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (token !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');

  const allIds = await getOrCacheWildlifeIds();
  const total = allIds.length;
  const batch = allIds.slice(offset, offset + PROCESS_LIMIT);

  let created = 0;
  let skipped = 0;

  const appointments = await fetchInBatches(batch);

  for (const appt of appointments) {
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
      skipped++;
    }
  }

  const nextOffset = offset + PROCESS_LIMIT;
  const hasMore = nextOffset < total;

  // Clear cache when done
  if (!hasMore) {
    await prisma.appSetting.delete({ where: { key: 'csr_dfw_backfill_ids' } }).catch(() => {});
  }

  return NextResponse.json({
    status: hasMore ? 'in_progress' : 'done',
    total,
    offset,
    processed: batch.length,
    created,
    skipped,
    hasMore,
    nextUrl: hasMore ? `/api/sync/csr-dfw-backfill?token=critterstop2026&offset=${nextOffset}` : null,
  });
}
