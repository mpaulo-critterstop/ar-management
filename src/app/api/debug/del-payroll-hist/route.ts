import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
// Delete backfilled historical payroll weeks (the broken import). Identifies weeks whose entries are backfilled.
// Keeps any week that has NON-backfilled (live-entered) data. Dry-run default; &confirm=1 to delete.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('confirm') !== '1';

  const weeks = await prisma.payrollWeek.findMany({ include: { entries: { select: { backfilled: true } } } });
  const toDelete: string[] = []; const keep: any[] = [];
  for (const w of weeks) {
    const n = w.entries.length;
    const bf = w.entries.filter(e => e.backfilled).length;
    // A week is "historical backfill" if it has entries and ALL of them are backfilled.
    if (n > 0 && bf === n) toDelete.push(w.id);
    else keep.push({ date: w.weekDate.toISOString().split('T')[0], region: w.region, entries: n, backfilled: bf, status: w.status });
  }

  if (dry) {
    const delDates = weeks.filter(w => toDelete.includes(w.id)).map(w => ({ date: w.weekDate.toISOString().split('T')[0], region: w.region, entries: w.entries.length }));
    return NextResponse.json({ dry: true, totalWeeks: weeks.length, willDelete: toDelete.length, willKeep: keep.length, keepSample: keep.slice(0, 20), deleteSample: delDates.slice(0, 10), deleteDateRange: delDates.length ? `${delDates.map(d=>d.date).sort()[0]} .. ${delDates.map(d=>d.date).sort().slice(-1)[0]}` : null });
  }

  let deleted = 0;
  for (const id of toDelete) { await prisma.payrollWeek.delete({ where: { id } }).catch(() => {}); deleted++; }
  return NextResponse.json({ ok: true, deletedWeeks: deleted, keptWeeks: keep.length });
}
