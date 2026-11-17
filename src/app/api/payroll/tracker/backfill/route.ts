import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import backfillData from '@/data/payroll_backfill.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Backfill historical payroll weeks from the Excel tracker (src/data/payroll_backfill.json).
// Each week is created as FINALIZED (read-only history) with entries carrying stored OT Total + Final Total
// as-is (old rate+$3 method). Names are matched to Employee records where possible (for the link), else the
// entry still stores the name. Idempotent: skips weeks that already exist.
// ?token=critterstop2026  &dry=1 to preview  &from=YYYY-MM-DD &to=YYYY-MM-DD to limit the range.

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const from = sp.get('from'); // inclusive
  const to = sp.get('to');

  const weeks = (backfillData as any[]).filter(w => {
    if (from && w.weekDate < from) return false;
    if (to && w.weekDate > to) return false;
    return true;
  });

  const employees = await prisma.employee.findMany({ select: { id: true, fullName: true } });
  const empByName = new Map(employees.map(e => [norm(e.fullName), e.id]));

  const existing = await prisma.payrollWeek.findMany({ select: { weekDate: true } });
  const existingDates = new Set(existing.map(w => w.weekDate.toISOString().split('T')[0]));

  let weeksCreated = 0, weeksSkipped = 0, entriesCreated = 0, unmatchedNames = new Set<string>();

  for (const w of weeks) {
    if (existingDates.has(w.weekDate)) { weeksSkipped++; continue; }
    const weekDate = new Date(w.weekDate + 'T00:00:00.000Z');
    const entries = w.entries.map((e: any) => {
      const empId = empByName.get(norm(e.name));
      if (!empId) unmatchedNames.add(e.name);
      return {
        employeeId: empId || `unmatched:${norm(e.name)}`, // store a stable placeholder when no employee link
        name: e.name, roleCode: e.role || null, rate: e.rate || 0,
        regularHours: e.regularHours || 0, otHours: 0,
        otTotalOverride: e.otTotalOverride || 0,
        tolls: e.tolls || 0, otherDeductions: e.otherDeductions || 0,
        otherEarnings: e.otherEarnings || 0, commissions: 0, bonus: 0,
        finalTotalOverride: e.finalTotalOverride || 0, backfilled: true,
      };
    });
    if (!dry) {
      await prisma.payrollWeek.create({
        data: {
          weekDate, region: 'US', status: 'finalized', finalizedAt: new Date(),
          checklist: JSON.stringify({}),
          entries: { create: entries },
        },
      });
    }
    weeksCreated++; entriesCreated += entries.length;
  }

  return NextResponse.json({
    dry, totalWeeksInFile: (backfillData as any[]).length, weeksInRange: weeks.length,
    weeksCreated, weeksSkipped, entriesCreated,
    unmatchedNameCount: unmatchedNames.size,
    unmatchedSample: [...unmatchedNames].slice(0, 25),
  });
}
