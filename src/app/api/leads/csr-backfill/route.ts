import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const FR_OFFICES = [
  { key: 'DFW', apiKey: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW! },
  { key: 'ATX', apiKey: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX! },
  { key: 'OKC', apiKey: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC! },
  { key: 'CStat', apiKey: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
];

const BASE = 'https://critterstoppest.fieldroutes.com/api';

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${BASE}/${endpoint}?authenticationKey=${key}&authenticationToken=${token}&${params}`;
  const res = await fetch(url);
  return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// In-memory cache for this run to avoid repeat FR calls for the same ID.
const employeeResolveCache = new Map<string, { id: string; name: string; isCsr: boolean } | null>();

// Resolve an frEmployeeId to a CSR employee record. If not in csr_employees, look it up live
// in FieldRoutes (across offices), auto-create the mapping, and cache it. Self-healing: new FR
// employee IDs ("ghost IDs") get mapped automatically without manual inserts.
async function resolveCsrEmployee(frEmployeeId: string): Promise<{ id: string; name: string; isCsr: boolean } | null> {
  if (frEmployeeId === '0' || !frEmployeeId) return null;
  if (employeeResolveCache.has(frEmployeeId)) return employeeResolveCache.get(frEmployeeId)!;

  const existing = await prisma.csrEmployee.findUnique({ where: { frEmployeeId } });
  if (existing) {
    const r = { id: existing.id, name: existing.name, isCsr: existing.isCsr };
    employeeResolveCache.set(frEmployeeId, r);
    return r;
  }

  // Not in table — ask FieldRoutes. Employee lives in one office; try each key until found.
  // Auto-created mappings default to isCsr=false (unknown booker); a human can flip known CSRs
  // to true later. This keeps non-CSR bookers counted in totals but out of the per-agent table.
  for (const office of FR_OFFICES) {
    try {
      const data = await frFetch('employee/get', `employeeIDs=${frEmployeeId}`, office.apiKey, office.token);
      const emp = (data.employees || [])[0];
      if (emp) {
        const name = `${(emp.fname || '').trim()} ${(emp.lname || '').trim()}`.trim();
        if (name) {
          // If this name already exists as a known CSR (a prior ID for the same person),
          // inherit isCsr=true. Otherwise default false (unknown/non-CSR booker).
          const sameName = await prisma.csrEmployee.findFirst({ where: { name, isCsr: true } });
          const isCsr = !!sameName;
          const created = await prisma.csrEmployee.upsert({
            where: { frEmployeeId },
            create: { frEmployeeId, name, isCsr },
            update: { name },
          });
          // If a manual "pending_" placeholder existed for this name, remove it now that a real ID exists.
          if (isCsr) {
            await prisma.csrEmployee.deleteMany({ where: { name, frEmployeeId: { startsWith: 'pending_' } } });
          }
          const r = { id: created.id, name: created.name, isCsr: created.isCsr };
          employeeResolveCache.set(frEmployeeId, r);
          return r;
        }
      }
    } catch { /* try next office */ }
    await sleep(200);
  }

  employeeResolveCache.set(frEmployeeId, null);
  return null;
}

async function upsertCsrLead(csrApptId: string, groupId: string, frEmployeeId: string, role: string, points: number) {
  const csrEmployee = await resolveCsrEmployee(frEmployeeId);
  await prisma.csrLead.upsert({
    where: { leadId_role: { leadId: csrApptId, role } },
    create: {
      leadId: csrApptId,
      groupId,
      frEmployeeId,
      csrEmployeeId: csrEmployee?.id || null,
      csrName: csrEmployee?.name || null,
      points,
      role,
    },
    update: {
      groupId,
      frEmployeeId,
      csrEmployeeId: csrEmployee?.id || null,
      csrName: csrEmployee?.name || null,
      points,
    },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (token !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '40');
  const mode = req.nextUrl.searchParams.get('mode') || 'full';

  // Clear all existing CSR leads on first run (full mode only)
  if (mode === 'full' && offset === 0) {
    await prisma.csrLead.deleteMany({});
  }

  // Fetch from csr_appointments
  // In incremental mode, only fetch records not yet in csr_leads
  const allAppts = mode === 'incremental'
    ? await prisma.$queryRaw<any[]>`
        SELECT ca.id, ca."externalId", ca.office, ca."appointmentDate", ca."serviceTypeId", ca."originalAppointmentId", ca."employeeId"
        FROM "csr_appointments" ca
        WHERE ca."appointmentDate" >= '2026-01-01'
        AND NOT EXISTS (
          SELECT 1 FROM "csr_leads" cl WHERE cl."leadId" = ca.id
        )
        ORDER BY ca."appointmentDate" ASC
      `
    : await prisma.$queryRaw<any[]>`
        SELECT id, "externalId", office, "appointmentDate", "serviceTypeId", "originalAppointmentId", "employeeId"
        FROM "csr_appointments"
        WHERE "appointmentDate" >= '2026-01-01'
        ORDER BY "appointmentDate" ASC
      `;

  const total = allAppts.length;
  const batch = allAppts.slice(offset, offset + limit);

  // Group by office for bulk FR fetches
  const byOffice: Record<string, typeof batch> = {};
  for (const appt of batch) {
    if (!byOffice[appt.office]) byOffice[appt.office] = [];
    byOffice[appt.office].push(appt);
  }

  // For each appt, we already have employeeId and originalAppointmentId from csr_appointments
  // We only need to fetch original appointment from FR if originalAppointmentId != externalId
  const originalsToFetch: Record<string, { officeKey: string; originalId: string }> = {};
  for (const appt of batch) {
    if (appt.originalAppointmentId && appt.originalAppointmentId !== appt.externalId) {
      originalsToFetch[appt.externalId] = { officeKey: appt.office, originalId: appt.originalAppointmentId };
    }
  }

  // Fetch original appointments in bulk per office
  const originalApptMap: Record<string, { employeeId: string }> = {};
  const byOfficeOriginals: Record<string, string[]> = {};
  for (const { officeKey, originalId } of Object.values(originalsToFetch)) {
    if (!byOfficeOriginals[officeKey]) byOfficeOriginals[officeKey] = [];
    if (!byOfficeOriginals[officeKey].includes(originalId)) {
      byOfficeOriginals[officeKey].push(originalId);
    }
  }

  for (const [officeKey, ids] of Object.entries(byOfficeOriginals)) {
    const office = FR_OFFICES.find(o => o.key === officeKey);
    if (!office) continue;
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50).join(',');
      const data = await frFetch('appointment/get', `appointmentIDs=${chunk}`, office.apiKey, office.token);
      await sleep(1100);
      for (const a of (data.appointments || [])) {
        originalApptMap[String(a.appointmentID)] = { employeeId: String(a.employeeID || '0') };
      }
    }
  }

  // Assign points
  const log: string[] = [];
  let processed = 0;
  let errors = 0;

  for (const appt of batch) {
    try {
      const completedBookerId = appt.employeeId || '0';
      const isRescheduled = appt.originalAppointmentId && appt.originalAppointmentId !== appt.externalId;
      const groupId = appt.originalAppointmentId || appt.externalId;

      if (!isRescheduled) {
        await upsertCsrLead(appt.id, groupId, completedBookerId, 'original', 1.0);
      } else {
        const originalAppt = originalApptMap[appt.originalAppointmentId];
        const originalBookerId = originalAppt?.employeeId || completedBookerId;

        if (originalBookerId === completedBookerId) {
          await upsertCsrLead(appt.id, groupId, completedBookerId, 'original', 1.0);
        } else {
          await upsertCsrLead(appt.id, groupId, originalBookerId, 'original', 0.5);
          await upsertCsrLead(appt.id, groupId, completedBookerId, 'rescheduler', 0.5);
        }
      }
      processed++;
    } catch (e: any) {
      errors++;
      log.push(`ERROR ${appt.externalId}: ${e.message}`);
    }
  }

  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return NextResponse.json({
    status: hasMore ? 'in_progress' : 'done',
    total,
    offset,
    limit,
    processed,
    errors,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
    nextUrl: hasMore ? `/api/leads/csr-backfill?token=critterstop2026&offset=${nextOffset}&limit=${limit}` : null,
    log: log.slice(0, 20),
  });
}
