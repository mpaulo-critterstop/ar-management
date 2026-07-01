// src/app/api/cron/leads-forecast/route.ts
// Daily cron: posts upcoming wildlife inspection counts per day and per PM to Slack #adsmanagement

import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://critterstoppest.fieldroutes.com/api';
const WILDLIFE_SERVICE_IDS = new Set(['619', '645', '294', '676', '719', '514', '544', '612', '508', '681']);

const OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }
function fmtDisplay(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = fmtDate(tomorrow);
  const farFuture = new Date(today);
  farFuture.setFullYear(farFuture.getFullYear() + 1);
  const farFutureStr = fmtDate(farFuture);

  const byOffice: Record<string, number> = { DFW: 0, ATX: 0, OKC: 0, CStat: 0 };
  const byPmDate: Record<string, Record<string, number>> = {};

  for (const [officeName, cfg] of Object.entries(OFFICES)) {
    if (!cfg.key || !cfg.token) continue;
    const auth = `authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

    try {
      // 1. Search for upcoming appointments
      const searchData = await fetch(`${BASE_URL}/appointment/search?officeIDs=${cfg.officeId}&dateStart=${tomorrowStr}&dateEnd=${farFutureStr}&${auth}`).then(r => r.json());
      const apptIds: number[] = searchData.appointmentIDs || [];
      if (apptIds.length === 0) continue;

      // 2. Fetch appointment details in batches
      const allAppts: any[] = [];
      for (let i = 0; i < apptIds.length; i += 100) {
        const batch = apptIds.slice(i, i + 100);
        const apptData = await fetch(`${BASE_URL}/appointment/get?appointmentIDs=${batch.join(',')}&${auth}`).then(r => r.json());
        const prop = apptData.propertyName;
        if (apptData.success && prop && apptData[prop]) {
          const items = Array.isArray(apptData[prop]) ? apptData[prop] : Object.values(apptData[prop] as object);
          allAppts.push(...items);
        }
        await new Promise(r => setTimeout(r, 300));
      }

      // 3. Filter to pending wildlife inspections
      const wildlife = allAppts.filter((a: any) => {
        const typeStr = String(a.type || a.serviceTypeID || '');
        return WILDLIFE_SERVICE_IDS.has(typeStr) && String(a.status) === '0';
      });

      byOffice[officeName] += wildlife.length;
      if (wildlife.length === 0) continue;

      // 4. Collect unique routeIDs and fetch routes to get assignedTech
      const routeIds = [...new Set(wildlife.map((a: any) => String(a.routeID || '0')).filter(id => id !== '0'))];
      const routeToTech: Record<string, string> = {};
      for (let i = 0; i < routeIds.length; i += 100) {
        const batch = routeIds.slice(i, i + 100);
        const routeData = await fetch(`${BASE_URL}/route/get?routeIDs=${batch.join(',')}&${auth}`).then(r => r.json());
        const prop = routeData.propertyName;
        const routes: any[] = prop && routeData[prop] ? (Array.isArray(routeData[prop]) ? routeData[prop] : Object.values(routeData[prop] as object)) : [];
        for (const route of routes) {
          if (route.assignedTech && route.assignedTech !== '0') {
            routeToTech[String(route.routeID)] = String(route.assignedTech);
          }
        }
        await new Promise(r => setTimeout(r, 300));
      }

      // 5. Resolve employee names
      const empIds = [...new Set(Object.values(routeToTech))];
      const empMap: Record<string, string> = {};
      for (let i = 0; i < empIds.length; i += 100) {
        const batch = empIds.slice(i, i + 100);
        const empData = await fetch(`${BASE_URL}/employee/get?employeeIDs=${batch.join(',')}&${auth}`).then(r => r.json());
        empData.employees?.forEach((e: any) => {
          empMap[String(e.employeeID)] = `${e.fname} ${e.lname}`.trim();
        });
        await new Promise(r => setTimeout(r, 300));
      }

      // 6. Group by PM and date
      for (const appt of wildlife) {
        const routeId = String(appt.routeID || '0');
        const techId = routeToTech[routeId] || '0';
        const pmName = empMap[techId] || `Unassigned`;
        const dateStr = (appt.date || '').split('T')[0] || String(appt.date || '');
        if (!dateStr) continue;
        if (!byPmDate[pmName]) byPmDate[pmName] = {};
        byPmDate[pmName][dateStr] = (byPmDate[pmName][dateStr] || 0) + 1;
      }

    } catch (e: any) {
      console.error(`Error fetching ${officeName}:`, e.message);
    }
  }

  const total = Object.values(byOffice).reduce((s, n) => s + n, 0);

  const lines: string[] = [];
  lines.push(`*Upcoming Wildlife Inspections*`);
  lines.push('');
  lines.push(`Total Leads - ${total}`);
  lines.push(`DFW Leads - ${byOffice.DFW}`);
  lines.push(`ATX Leads - ${byOffice.ATX}`);
  lines.push(`OKC Leads - ${byOffice.OKC}`);
  lines.push(`CStat Leads - ${byOffice.CStat}`);

  const sortedPMs = Object.keys(byPmDate).sort();
  for (const pm of sortedPMs) {
    lines.push('');
    lines.push(`*${pm}*`);
    const sortedDates = Object.keys(byPmDate[pm]).sort();
    for (const date of sortedDates) {
      lines.push(`${fmtDisplay(date)} - ${byPmDate[pm][date]}`);
    }
  }

  const message = lines.join('\n');
  const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_ADS!;
  if (SLACK_WEBHOOK) {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
  }

  return NextResponse.json({ success: true, total, byOffice, message });
}
