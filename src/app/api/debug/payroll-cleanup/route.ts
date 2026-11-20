import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Remove backfilled historical payroll weeks (US + International). A week is backfilled if it has entries and
// EVERY entry has backfilled=true (no live-entered week). Dry-run default. ?token=critterstop2026 &confirm=1
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('confirm') !== '1';

  const weeks = await prisma.payrollWeek.findMany({ include: { entries: { select: { backfilled: true } } } });
  const toDelete: { id: string; weekDate: string; region: string; entries: number }[] = [];
  const keep: { weekDate: string; region: string; entries: number; reason: string }[] = [];

  for (const w of weeks) {
    const n = w.entries.length;
    const allBackfilled = n > 0 && w.entries.every(e => e.backfilled);
    if (allBackfilled) {
      toDelete.push({ id: w.id, weekDate: w.weekDate.toISOString().split('T')[0], region: w.region, entries: n });
    } else {
      keep.push({ weekDate: w.weekDate.toISOString().split('T')[0], region: w.region, entries: n, reason: n === 0 ? 'empty' : 'has live-entered entries' });
    }
  }

  if (dry) {
    const byRegion: Record<string, number> = {};
    for (const d of toDelete) byRegion[d.region] = (byRegion[d.region] || 0) + 1;
    return NextResponse.json({ dry: true, totalWeeks: weeks.length, willDelete: toDelete.length, byRegion, keeping: keep.length, keepSample: keep.slice(0, 20), deleteSample: toDelete.slice(0, 10), note: 'add &confirm=1 to delete' });
  }

  let deleted = 0;
  for (const d of toDelete) { await prisma.payrollWeek.delete({ where: { id: d.id } }); deleted++; } // cascade removes entries
  return NextResponse.json({ ok: true, deletedWeeks: deleted, keptWeeks: keep.length });
}
