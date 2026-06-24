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
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20');

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
  const log: string[] = [];
  let processed = 0;
  let errors = 0;

  for (const lead of batch) {
    const office = FR_OFFICES.find(o => o.key === lead.office);
    if (!office) { log.push(`Unknown office for lead ${lead.externalId}`); continue; }

    try {
      // Fetch the appointment to get groupId
      const apptData = await frFetch('appointment/get', `appointmentIDs=${lead.externalId}`, office.apiKey, office.token);
      await sleep(1100);

      const appt = apptData.appointments?.[0];
      if (!appt) { log.push(`No appointment found for ${lead.externalId}`); continue; }

      const groupId = appt.groupID && appt.groupID !== '0' ? String(appt.groupID) : null;

      if (!groupId) {
        // No group — solo booking, original CSR gets 1.0
        const bookerFrId = String(appt.employeeID || '0');
        await upsertCsrLead(lead.id, lead.externalId, bookerFrId, 'original', 1.0);
        await prisma.lead.update({ where: { id: lead.id }, data: { groupId: lead.externalId } });
        log.push(`${lead.externalId}: solo, booker=${bookerFrId}`);
        processed++;
        continue;
      }

      // Fetch all appointments in the group
      const groupData = await frFetch('appointment/search', `groupID=${groupId}`, office.apiKey, office.token);
      await sleep(1100);

      const groupIds = (groupData.appointmentIDs || []).slice(0, 50).join(',');
      if (!groupIds) {
        const bookerFrId = String(appt.employeeID || '0');
        await upsertCsrLead(lead.id, groupId, bookerFrId, 'original', 1.0);
        await prisma.lead.update({ where: { id: lead.id }, data: { groupId } });
        processed++;
        continue;
      }

      const groupAppts = await frFetch('appointment/get', `appointmentIDs=${groupIds}`, office.apiKey, office.token);
      await sleep(1100);

      const sorted = (groupAppts.appointments || [])
        .sort((a: any, b: any) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

      if (sorted.length <= 1) {
        const bookerFrId = String(appt.employeeID || '0');
        await upsertCsrLead(lead.id, groupId, bookerFrId, 'original', 1.0);
      } else {
        const firstBooker = String(sorted[0].employeeID || '0');
        const lastRescheduler = String(sorted[sorted.length - 1].employeeID || '0');
        if (firstBooker === lastRescheduler) {
          await upsertCsrLead(lead.id, groupId, firstBooker, 'original', 1.0);
        } else {
          await upsertCsrLead(lead.id, groupId, firstBooker, 'original', 0.5);
          await upsertCsrLead(lead.id, groupId, lastRescheduler, 'rescheduler', 0.5);
        }
      }

      await prisma.lead.update({ where: { id: lead.id }, data: { groupId } });
      log.push(`${lead.externalId}: group=${groupId}, appts=${sorted.length}`);
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
    log,
  });
}
