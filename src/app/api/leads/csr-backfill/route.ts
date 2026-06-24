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

  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');

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

  // Step 1: Fetch all appointments in this batch in one go per office
  const byOffice: Record<string, typeof batch> = {};
  for (const lead of batch) {
    if (!byOffice[lead.office]) byOffice[lead.office] = [];
    byOffice[lead.office].push(lead);
  }

  // Map: externalId -> { groupId, employeeID }
  const apptMap: Record<string, { groupId: string | null; employeeId: string }> = {};

  for (const [officeKey, leads] of Object.entries(byOffice)) {
    const office = FR_OFFICES.find(o => o.key === officeKey);
    if (!office) continue;

    // Fetch up to 50 appointments at once
    const ids = leads.map(l => l.externalId).join(',');
    const data = await frFetch('appointment/get', `appointmentIDs=${ids}`, office.apiKey, office.token);
    await sleep(1100);

    for (const appt of (data.appointments || [])) {
      const groupId = appt.groupID && appt.groupID !== '0' ? String(appt.groupID) : null;
      apptMap[String(appt.appointmentID)] = { groupId, employeeId: String(appt.employeeID || '0') };
    }
  }

  // Step 2: Find unique groupIds we need to resolve
  const groupsToResolve: Record<string, { office: string; ids: string[] }> = {};
  for (const lead of batch) {
    const appt = apptMap[lead.externalId];
    if (!appt?.groupId) continue;
    if (!groupsToResolve[appt.groupId]) {
      groupsToResolve[appt.groupId] = { office: lead.office, ids: [] };
    }
  }

  // Step 3: For each unique group, fetch group members (deduplicated!)
  // groupId -> { firstBooker, lastRescheduler }
  const groupCache: Record<string, { firstBooker: string; lastRescheduler: string }> = {};

  for (const [groupId, { office: officeKey }] of Object.entries(groupsToResolve)) {
    const office = FR_OFFICES.find(o => o.key === officeKey);
    if (!office) continue;

    const searchData = await frFetch('appointment/search', `groupID=${groupId}`, office.apiKey, office.token);
    await sleep(1100);

    const groupApptIds = (searchData.appointmentIDs || []).slice(0, 50).join(',');
    if (!groupApptIds) {
      groupCache[groupId] = { firstBooker: '0', lastRescheduler: '0' };
      continue;
    }

    const groupAppts = await frFetch('appointment/get', `appointmentIDs=${groupApptIds}`, office.apiKey, office.token);
    await sleep(1100);

    const sorted = (groupAppts.appointments || [])
      .sort((a: any, b: any) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

    groupCache[groupId] = {
      firstBooker: String(sorted[0]?.employeeID || '0'),
      lastRescheduler: String(sorted[sorted.length - 1]?.employeeID || '0'),
    };
  }

  // Step 4: Assign points to each lead
  const log: string[] = [];
  let processed = 0;
  let errors = 0;

  for (const lead of batch) {
    try {
      const appt = apptMap[lead.externalId];
      if (!appt) { log.push(`No appointment: ${lead.externalId}`); continue; }

      const groupId = appt.groupId || lead.externalId;

      if (!appt.groupId) {
        // Solo booking
        await upsertCsrLead(lead.id, groupId, appt.employeeId, 'original', 1.0);
      } else {
        const group = groupCache[appt.groupId];
        if (!group) { log.push(`No group data: ${lead.externalId}`); continue; }

        if (group.firstBooker === group.lastRescheduler) {
          await upsertCsrLead(lead.id, appt.groupId, group.firstBooker, 'original', 1.0);
        } else {
          await upsertCsrLead(lead.id, appt.groupId, group.firstBooker, 'original', 0.5);
          await upsertCsrLead(lead.id, appt.groupId, group.lastRescheduler, 'rescheduler', 0.5);
        }
      }

      await prisma.lead.update({ where: { id: lead.id }, data: { groupId } });
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
    uniqueGroups: Object.keys(groupCache).length,
    log: log.slice(0, 20),
  });
}
