import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const effHourly = (e: any): number => {
  if (e.payType === 'Salary') return e.annualSalary != null ? e.annualSalary / 52 / 40 : 0;
  return e.hourlyRate ?? 0;
};
const DEFAULT_CHECKLIST = [
  'Add new hires to OnPay', 'Remove fired / resigned', 'Check hours in FieldRoutes',
  'Weekend jobs ($50/job)', 'Check for PTO', 'Pull tolls & deductions', 'Check commissions', 'Check OnTheClock hours',
];

// GET ?list=1 -> list of weeks; GET ?week=YYYY-MM-DD -> that week's entries (region defaults US)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const region = sp.get('region') || 'US';

  if (sp.get('list') === '1') {
    const weeks = await prisma.payrollWeek.findMany({ where: { region }, orderBy: { weekDate: 'desc' }, select: { id: true, weekDate: true, status: true } });
    return NextResponse.json({ weeks });
  }

  const weekStr = sp.get('week');
  if (!weekStr) return NextResponse.json({ error: 'week required' }, { status: 400 });
  const weekDate = new Date(weekStr + 'T00:00:00.000Z');

  let week = await prisma.payrollWeek.findFirst({ where: { weekDate, region }, include: { entries: true } });

  // Auto-create the week + seed entries from active employees of the region if it doesn't exist.
  if (!week) {
    const emps = await prisma.employee.findMany({ where: { region, active: true }, orderBy: { fullName: 'asc' } });
    week = await prisma.payrollWeek.create({
      data: {
        weekDate, region, status: 'draft', checklist: JSON.stringify({}),
        entries: {
          create: emps.map(e => ({
            employeeId: e.id, name: e.fullName, roleCode: e.region === 'International' ? (e.position || null) : (e.roleCode || null),
            rate: effHourly(e), regularHours: 0, otHours: 0, tolls: 0, otherDeductions: 0, otherEarnings: 0, commissions: 0, bonus: 0,
          })),
        },
      },
      include: { entries: true },
    });
  }

  const entries = week.entries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(en => {
      const regTotal = en.rate * en.regularHours;
      const otTotal = en.otTotalOverride != null ? en.otTotalOverride : en.rate * 1.5 * en.otHours;
      const computedFinal = regTotal + otTotal - en.tolls - en.otherDeductions + en.otherEarnings + en.commissions + en.bonus;
      const finalTotal = en.finalTotalOverride != null ? en.finalTotalOverride : computedFinal;
      return { ...en, regTotal, otTotal, finalTotal };
    });

  return NextResponse.json({
    week: { id: week.id, weekDate: week.weekDate, status: week.status, checklist: week.checklist ? JSON.parse(week.checklist) : {} },
    entries,
    checklistItems: DEFAULT_CHECKLIST,
  });
}

export async function POST(req: NextRequest) {
  const b = await req.json();

  if (b.action === 'saveEntry') {
    const fields = ['regularHours', 'otHours', 'tolls', 'otherDeductions', 'otherEarnings', 'commissions', 'bonus', 'notes'];
    const data: any = {};
    for (const f of fields) if (b[f] !== undefined) data[f] = f === 'notes' ? (b[f] || null) : (Number(b[f]) || 0);
    await prisma.payrollEntry.update({ where: { id: b.entryId }, data });
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'saveChecklist') {
    await prisma.payrollWeek.update({ where: { id: b.weekId }, data: { checklist: JSON.stringify(b.checklist || {}) } });
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'finalize') {
    await prisma.payrollWeek.update({ where: { id: b.weekId }, data: { status: 'finalized', finalizedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'reopen') {
    await prisma.payrollWeek.update({ where: { id: b.weekId }, data: { status: 'draft', finalizedAt: null } });
    return NextResponse.json({ ok: true });
  }

  // Re-sync the roster: add any active employees missing from this week (e.g., new hires), without touching existing entries.
  if (b.action === 'syncRoster') {
    const week = await prisma.payrollWeek.findUnique({ where: { id: b.weekId }, include: { entries: true } });
    if (!week) return NextResponse.json({ error: 'week not found' }, { status: 404 });
    const have = new Set(week.entries.map(e => e.employeeId));
    const emps = await prisma.employee.findMany({ where: { region: week.region, active: true } });
    const missing = emps.filter(e => !have.has(e.id));
    for (const e of missing) {
      await prisma.payrollEntry.create({ data: { weekId: week.id, employeeId: e.id, name: e.fullName, roleCode: e.region === 'International' ? (e.position || null) : (e.roleCode || null), rate: effHourly(e) } });
    }
    return NextResponse.json({ ok: true, added: missing.length });
  }

  // Delete draft weeks that have no entered data (junk auto-created empties), except the current real draft.
  if (b.action === 'deleteEmptyWeeks') {
    const drafts = await prisma.payrollWeek.findMany({ where: { status: 'draft' }, include: { entries: true } });
    let deleted = 0; const kept: string[] = [];
    for (const w of drafts) {
      const hasData = w.entries.some(e => e.regularHours || e.otHours || e.tolls || e.otherDeductions || e.otherEarnings || e.commissions || e.bonus || e.otTotalOverride || e.finalTotalOverride);
      if (!hasData) { await prisma.payrollWeek.delete({ where: { id: w.id } }); deleted++; }
      else kept.push(w.weekDate.toISOString().split('T')[0]);
    }
    return NextResponse.json({ ok: true, deleted, keptWithData: kept });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
