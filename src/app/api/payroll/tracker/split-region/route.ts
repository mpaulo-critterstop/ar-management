import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Fix the backfill that put US + International employees together in US weeks.
// For each US week, find entries whose matched employee is region='International', and MOVE them into the
// corresponding International PayrollWeek (same weekDate), creating that week if needed. Idempotent.
// ?token=critterstop2026 &dry=1
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';

  const intlEmps = await prisma.employee.findMany({ where: { region: 'International' }, select: { id: true } });
  const intlIds = new Set(intlEmps.map(e => e.id));

  const usWeeks = await prisma.payrollWeek.findMany({ where: { region: 'US' }, include: { entries: true } });

  let moved = 0, intlWeeksCreated = 0, weeksTouched = 0;
  const sample: any[] = [];

  try {
  for (const w of usWeeks) {
    const toMove = w.entries.filter(e => intlIds.has(e.employeeId));
    if (!toMove.length) continue;
    weeksTouched++;

    if (!dry) {
      // find or create the International week for this date
      let intlWeek = await prisma.payrollWeek.findFirst({ where: { weekDate: w.weekDate, region: 'International' } });
      if (!intlWeek) {
        intlWeek = await prisma.payrollWeek.create({ data: { weekDate: w.weekDate, region: 'International', status: w.status, finalizedAt: w.finalizedAt, checklist: JSON.stringify({}) } });
        intlWeeksCreated++;
      }
      for (const e of toMove) {
        // move: update the entry's weekId (unique constraint is weekId+employeeId, safe)
        await prisma.payrollEntry.update({ where: { id: e.id }, data: { weekId: intlWeek.id } }).catch(async () => {
          // if a dup exists in target, just delete the US one
          await prisma.payrollEntry.delete({ where: { id: e.id } }).catch(() => {});
        });
        moved++;
      }
    } else {
      moved += toMove.length;
      if (sample.length < 10) sample.push({ week: w.weekDate.toISOString().split('T')[0], names: toMove.map(e => e.name) });
    }
  }

  } catch (e) {
    return NextResponse.json({ error: String(e), movedSoFar: moved, weeksTouched }, { status: 500 });
  }
  return NextResponse.json({ dry, usWeeksScanned: usWeeks.length, weeksTouched, entriesMoved: moved, intlWeeksCreated, sample });
}
