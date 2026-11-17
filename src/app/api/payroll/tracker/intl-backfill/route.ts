import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import intlData from '@/data/intl_payroll_backfill.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Re-backfill International payroll weeks from the correct international section of the Excel
// (src/data/intl_payroll_backfill.json). Fixes the earlier backfill that pulled intl people from the US-section
// columns. Stores the sheet's actual OT$, Total, and USD total as-is (overrides), sets each week's usdRate, and
// updates each employee's payrollSchedule (Frequency / Platform) from the latest week.
// ?token=critterstop2026 &dry=1  &wipe=1 (delete existing intl weeks first for a clean redo)
const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const wipe = sp.get('wipe') === '1';

  const data = intlData as any;
  const weeks = data.weeks as any[];
  const latestSchedule = data.latestSchedule as Record<string, string>;

  const employees = await prisma.employee.findMany({ where: { region: 'International' }, select: { id: true, fullName: true } });
  const empByName = new Map(employees.map(e => [norm(e.fullName), e.id]));

  let wiped = 0;
  if (wipe && !dry) {
    const del = await prisma.payrollWeek.deleteMany({ where: { region: 'International' } });
    wiped = del.count;
  }

  let weeksCreated = 0, entriesCreated = 0, schedulesSet = 0;
  const unmatched = new Set<string>();

  if (!dry) {
    for (const w of weeks) {
      const weekDate = new Date(w.weekDate + 'T00:00:00.000Z');
      // skip if this intl week already exists (unless we wiped)
      const exists = await prisma.payrollWeek.findFirst({ where: { weekDate, region: 'International' } });
      if (exists) continue;
      const entries = w.entries.map((e: any) => {
        const empId = empByName.get(norm(e.name));
        if (!empId) unmatched.add(e.name);
        return {
          employeeId: empId || `unmatched:${norm(e.name)}`, name: e.name,
          roleCode: null, rate: e.rate || 0,
          regularHours: e.hours || 0, otHours: 0,
          otTotalOverride: e.otAmount || 0,      // sheet's OT $ as-is
          finalTotalOverride: e.total || 0,       // local-currency total as-is
          usdTotalOverride: e.usdTotal || 0,      // USD total as-is
          backfilled: true,
        };
      });
      await prisma.payrollWeek.create({
        data: { weekDate, region: 'International', status: 'finalized', finalizedAt: new Date(), usdRate: w.usdRate || null, checklist: JSON.stringify({}), entries: { create: entries } },
      });
      weeksCreated++; entriesCreated += entries.length;
    }
    // set payrollSchedule + currency on each employee from the latest week
    for (const [name, fp] of Object.entries(latestSchedule)) {
      const id = empByName.get(norm(name));
      if (id) { await prisma.employee.update({ where: { id }, data: { payrollSchedule: fp } }); schedulesSet++; }
    }
  }

  return NextResponse.json({
    dry, wipe, wiped,
    weeksInFile: weeks.length, totalEntries: weeks.reduce((a, w) => a + w.entries.length, 0),
    weeksCreated, entriesCreated, schedulesSet,
    unmatchedCount: unmatched.size, unmatchedSample: [...unmatched].slice(0, 20),
    sampleWeek: dry ? { date: weeks[0].weekDate, usdRate: weeks[0].usdRate, entries: weeks[0].entries.slice(0, 5).map((e: any) => ({ name: e.name, cur: e.currency, total: e.total, usd: e.usdTotal, fp: e.freqPlatform })) } : undefined,
  });
}
