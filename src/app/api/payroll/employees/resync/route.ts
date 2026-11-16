import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import importData from '@/data/raise_import.json';

export const dynamic = 'force-dynamic';

// Re-sync the Employee table from the updated Raise Tracker export (src/data/raise_import.json):
// - corrects region (US/International), office, techId/team, position, pay, raise history
// - applies terminations with end dates (explicit or inferred-from-last-payroll-week)
// - inferred end dates are flagged endDateInferred=true so they can be reviewed/edited in the UI
// Matches existing employees by normalized name; creates any missing (e.g., terminated people not migrated before).
// ?token=critterstop2026 &dry=1 to preview.

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const d = (v: any) => (v ? new Date(v) : null);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';

  const rows = (importData as any[]).filter(r => r.name && r.name !== 'Employee Name');
  const existing = await prisma.employee.findMany();
  const byName = new Map(existing.map(e => [norm(e.fullName), e]));

  let created = 0, updated = 0, terminated = 0, inferredEnds = 0;
  const actions: any[] = [];

  for (const r of rows) {
    const payType = r.region === 'International' ? 'Salary' : 'Hourly';
    const isTerminated = !!r.terminated;
    if (r.endDateInferred) inferredEnds++;
    if (isTerminated) terminated++;

    const base: any = {
      region: r.region || 'US',
      email: r.email || undefined,
      techId: r.techId || undefined,
      team: r.team || undefined,
      roleCode: r.team || undefined, // team short code doubles as roleCode (WP/PMP/IP)
      office: r.office || undefined,
      position: r.position || undefined,
      hireDate: d(r.startDate) || undefined,
      // pay: US hourly = rate as-is; International monthly*… already stored? keep rate as hourly for US, else annual via monthly×12 not available here, so store rate directly
      ...(payType === 'Hourly' && r.rate != null ? { payType: 'Hourly', hourlyRate: r.rate } : {}),
      pto: r.pto || undefined,
      bonusHistory: r.bonusHistory || undefined,
      mostRecentRaiseDate: d(r.mostRecentRaiseDate) || undefined,
      raiseAmount: r.raiseAmount || undefined,
      previousRaiseDate: d(r.previousRaiseDate) || undefined,
      previousRaiseAmount: r.previousRaiseAmount || undefined,
    };
    if (isTerminated) {
      base.active = false;
      base.status = 'Inactive';
      base.termDate = d(r.endDate) || undefined;
      base.endDateInferred = !!r.endDateInferred;
    }

    const key = norm(r.name);
    const match = byName.get(key);
    if (match) {
      if (!dry) await prisma.employee.update({ where: { id: match.id }, data: base });
      updated++;
      if (actions.length < 20) actions.push({ op: 'update', name: r.name, region: r.region, office: r.office, terminated: isTerminated, end: r.endDate, inferred: !!r.endDateInferred });
    } else {
      if (!dry) await prisma.employee.create({ data: { fullName: r.name, payType, status: isTerminated ? 'Inactive' : 'Active', active: !isTerminated, ...base } });
      created++;
      if (actions.length < 20) actions.push({ op: 'create', name: r.name, region: r.region, terminated: isTerminated });
    }
  }

  return NextResponse.json({
    dry, sourceRows: rows.length,
    created, updated, terminated, inferredEndDates: inferredEnds,
    note: 'Inferred end dates are flagged endDateInferred=true — review/edit them in the Employees UI.',
    sample: actions,
  });
}
