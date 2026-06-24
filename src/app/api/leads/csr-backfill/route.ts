import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const FR_OFFICES = [
  { key: 'DFW', apiKey: '6t0i20austp8ts2ln5296vi45qifgjrh08bbpfp1svijke8enjpr8d55qo81nsml', token: 'uinj35806p728f9bktr984gsml74a8to077g6ufpjcvlk7v5g0bgqe256l2nn5gb' },
  { key: 'ATX', apiKey: 'tf3d05a4f0rh4nlqs6rqkurjrvm2l7h7gsv0n4bc12uecibp6hjhd897d41pm1a9', token: '1hu3l8lei5ibv5hv48o8a8d5mldh67gdiorolpkjldodm5de1ehkkvi7h6upsqhe' },
  { key: 'OKC', apiKey: '0tg1jkgtbio4cthib607msc7cqifecjgjjh0jke1h73l8e34b94tguuno7b1stqf', token: 'o9mshmsqhv3f10s41qr1t6r56n1o8m2v7jtdlfu2jrpnipebs2fvugtb9omf6i1r' },
  { key: 'CStat', apiKey: 'v26mmb5lm48qnvciq271v189bseepdj3iechgt4tjjta75ee09lrjo4laou0d15l', token: 'q7b1tv49r3emq3mibkg43j71vt0qd60fgrjesjmqa3nnqe3brog3uadlvo03j3mj' },
];

const BASE = 'https://critterstoppest.fieldroutes.com/api';

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${BASE}/${endpoint}?authenticationKey=${key}&authenticationToken=${token}&${params}`;
  const res = await fetch(url);
  return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function upsertCsrLead(leadId: string, groupId: string, frEmployeeId: string, role: string, points: number) {
  const csrEmployee = await prisma.csrEmployee.findUnique({ where: { frEmployeeId } });
  await prisma.csrLead.upsert({
    where: { leadId_role: { leadId, role } },
    create: { leadId, groupId, frEmployeeId, csrEmployeeId: csrEmployee?.id || null, csrName: csrEmployee?.name || null, points, role },
    update: { groupId, frEmployeeId, csrEmployeeId: csrEmployee?.id || null, csrName: csrEmployee?.name || null, points },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (token !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Clear all existing CSR leads first if offset=0
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '40');

  if (offset === 0) {
    await prisma.csrLead.deleteMany({});
    await prisma.lead.updateMany({ data: { groupId: null } });
  }

  const allLeads = await prisma.lead.findMany({
    where: {
      inspectionDate: { gte: new Date('2026-01-01') },
      status: { in: ['SOLD', 'INSPECTED'] },
      NOT: { externalId: { startsWith: 'csv_' } },
    },
    select: { id: true, externalId: true, office: true },
    orderBy: { createdAt: 'asc' },
  });

  const total = allLeads.length;
  const batch = allLeads.slice(offset, offset + limit);

  // Group by office for bulk fetch
  const byOffice: Record<string, typeof batch> = {};
  for (const lead of batch) {
    if (!byOffice[lead.office]) byOffice[lead.office] = [];
    byOffice[lead.office].push(lead);
  }

  // Fetch all completed appointments in batch at once per office
  // apptId -> { employeeID, originalAppointmentID }
  const apptMap: Record<string, { employeeId: string; originalApptId: string }> = {};

  for (const [officeKey, leads] of Object.entries(byOffice)) {
    const office = FR_OFFICES.find(o => o.key === officeKey);
    if (!office) continue;

    const ids = leads.map(l => l.externalId).join(',');
    const data = await frFetch('appointment/get', `appointmentIDs=${ids}`, office.apiKey, office.token);
    await sleep(1100);

    for (const appt of (data.appointments || [])) {
      apptMap[String(appt.appointmentID)] = {
        employeeId: String(appt.employeeID || '0'),
        originalApptId: String(appt.originalAppointmentID || appt.appointmentID),
      };
    }
  }

  // Find which leads need original appointment lookup (where original != completed)
  const originalsToFetch: Record<string, { officeKey: string; originalId: string }> = {};
  for (const lead of batch) {
    const appt = apptMap[lead.externalId];
    if (!appt) continue;
    if (appt.originalApptId !== lead.externalId) {
      originalsToFetch[lead.externalId] = { officeKey: lead.office, originalId: appt.originalApptId };
    }
  }

  // Fetch original appointments in bulk per office (deduplicated)
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
    // Fetch in chunks of 50
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50).join(',');
      const data = await frFetch('appointment/get', `appointmentIDs=${chunk}`, office.apiKey, office.token);
      await sleep(1100);
      for (const appt of (data.appointments || [])) {
        originalApptMap[String(appt.appointmentID)] = { employeeId: String(appt.employeeID || '0') };
      }
    }
  }

  // Assign points
  const log: string[] = [];
  let processed = 0;
  let errors = 0;

  for (const lead of batch) {
    try {
      const appt = apptMap[lead.externalId];
      if (!appt) { log.push(`No appt: ${lead.externalId}`); continue; }

      const completedBookerId = appt.employeeId; // CSR on completed appointment
      const isRescheduled = appt.originalApptId !== lead.externalId;

      if (!isRescheduled) {
        // No reschedule — solo booking, completed CSR gets 1.0
        await upsertCsrLead(lead.id, lead.externalId, completedBookerId, 'original', 1.0);
        await prisma.lead.update({ where: { id: lead.id }, data: { groupId: lead.externalId } });
        log.push(`${lead.externalId}: solo, booker=${completedBookerId}`);
      } else {
        // Rescheduled — original booker gets 0.5, last CSR gets 0.5
        const originalAppt = originalApptMap[appt.originalApptId];
        const originalBookerId = originalAppt?.employeeId || completedBookerId;

        if (originalBookerId === completedBookerId) {
          // Same CSR — gets 1.0
          await upsertCsrLead(lead.id, appt.originalApptId, completedBookerId, 'original', 1.0);
        } else {
          await upsertCsrLead(lead.id, appt.originalApptId, originalBookerId, 'original', 0.5);
          await upsertCsrLead(lead.id, appt.originalApptId, completedBookerId, 'rescheduler', 0.5);
        }
        await prisma.lead.update({ where: { id: lead.id }, data: { groupId: appt.originalApptId } });
        log.push(`${lead.externalId}: rescheduled, original=${originalBookerId}, last=${completedBookerId}`);
      }
      processed++;
    } catch (e: any) {
      errors++;
      log.push(`ERROR ${lead.externalId}: ${e.message}`);
    }
  }

  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return NextResponse.json({
    status: 'done',
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
