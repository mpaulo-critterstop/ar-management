import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const FR_OFFICES = [
  { key: 'DFW', officeID: '1', apiKey: '6t0i20austp8ts2ln5296vi45qifgjrh08bbpfp1svijke8enjpr8d55qo81nsml', token: 'uinj35806p728f9bktr984gsml74a8to077g6ufpjcvlk7v5g0bgqe256l2nn5gb' },
  { key: 'ATX', officeID: '5', apiKey: 'tf3d05a4f0rh4nlqs6rqkurjrvm2l7h7gsv0n4bc12uecibp6hjhd897d41pm1a9', token: '1hu3l8lei5ibv5hv48o8a8d5mldh67gdiorolpkjldodm5de1ehkkvi7h6upsqhe' },
  { key: 'OKC', officeID: '3', apiKey: '0tg1jkgtbio4cthib607msc7cqifecjgjjh0jke1h73l8e34b94tguuno7b1stqf', token: 'o9mshmsqhv3f10s41qr1t6r56n1o8m2v7jtdlfu2jrpnipebs2fvugtb9omf6i1r' },
  { key: 'CStat', officeID: '4', apiKey: 'v26mmb5lm48qnvciq271v189bseepdj3iechgt4tjjta75ee09lrjo4laou0d15l', token: 'q7b1tv49r3emq3mibkg43j71vt0qd60fgrjesjmqa3nnqe3brog3uadlvo03j3mj' },
];

const BASE = 'https://critterstoppest.fieldroutes.com/api';

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${BASE}/${endpoint}?authenticationKey=${key}&authenticationToken=${token}&${params}`;
  const res = await fetch(url);
  return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function getAppointmentsByIds(ids: string[], key: string, token: string): Promise<any[]> {
  if (ids.length === 0) return [];
  // FR allows up to 100 IDs at once in GET
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const results: any[] = [];
  for (const chunk of chunks) {
    const data = await frFetch('appointment/get', `appointmentIDs=${chunk.join(',')}`, key, token);
    if (data.appointments) results.push(...data.appointments);
    await sleep(1100); // stay under 60 req/min
  }
  return results;
}

async function getGroupAppointments(groupId: string, officeKey: string): Promise<any[]> {
  const office = FR_OFFICES.find(o => o.key === officeKey);
  if (!office) return [];
  const data = await frFetch('appointment/search', `groupID=${groupId}`, office.apiKey, office.token);
  await sleep(1100);
  if (!data.appointmentIDs || data.appointmentIDs.length === 0) return [];
  const appts = await getAppointmentsByIds(data.appointmentIDs.map(String), office.apiKey, office.token);
  return appts;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (token !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const leads = await prisma.lead.findMany({
    where: {
      inspectionDate: { gte: new Date('2026-01-01') },
      status: { in: ['SOLD', 'INSPECTED'] },
      externalId: { not: undefined },
    },
    select: { id: true, externalId: true, office: true, inspectionDate: true },
  });

  const log: string[] = [];
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches of 10 to stay within rate limits
  const batches = [];
  for (let i = 0; i < leads.length; i += 10) batches.push(leads.slice(i, i + 10));

  for (const batch of batches) {
    // For each lead, fetch the appointment to get groupId
    const officeGroups: Record<string, string[]> = {};
    for (const lead of batch) {
      if (!officeGroups[lead.office]) officeGroups[lead.office] = [];
      officeGroups[lead.office].push(lead.externalId);
    }

    for (const [officeKey, ids] of Object.entries(officeGroups)) {
      const office = FR_OFFICES.find(o => o.key === officeKey);
      if (!office) continue;

      const appts = await getAppointmentsByIds(ids, office.apiKey, office.token);

      for (const appt of appts) {
        const lead = leads.find(l => l.externalId === String(appt.appointmentID));
        if (!lead) continue;

        const groupId = appt.groupID;
        if (!groupId || groupId === '0') {
          // No group — original booker gets 1.0
          const bookerFrId = String(appt.employeeID || '0');
          await upsertCsrLead(lead.id, groupId || String(appt.appointmentID), bookerFrId, 'original', 1.0);
          processed++;
          continue;
        }

        // Fetch all appointments in the group
        try {
          const groupAppts = await getGroupAppointments(groupId, officeKey);
          const sorted = groupAppts
            .filter((a: any) => a.type === String(appt.type))
            .sort((a: any, b: any) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

          if (sorted.length <= 1) {
            // Only one — original booker gets 1.0
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

          // Update lead with groupId
          await prisma.lead.update({ where: { id: lead.id }, data: { groupId } });
          processed++;
          log.push(`Lead ${lead.externalId}: groupId=${groupId}, appts=${sorted.length}`);
        } catch (e: any) {
          errors++;
          log.push(`Error lead ${lead.externalId}: ${e.message}`);
        }
      }
    }
    await sleep(500);
  }

  return NextResponse.json({
    status: 'done',
    totalLeads: leads.length,
    processed,
    skipped,
    errors,
    log: log.slice(0, 100),
  });
}

async function upsertCsrLead(leadId: string, groupId: string, frEmployeeId: string, role: string, points: number) {
  const csrEmployee = await prisma.csrEmployee.findUnique({ where: { frEmployeeId } });

  await prisma.csrLead.upsert({
    where: { leadId_role: { leadId, role } },
    create: {
      leadId,
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
