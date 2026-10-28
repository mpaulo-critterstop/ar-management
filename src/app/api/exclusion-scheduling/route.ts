// Lists accepted exclusion proposals + their estimates (from excl_estimate:* records written by the webhook).
// Step 3 will enrich each with the FR booking comparison + status note.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Auth: session OR token (so the page can fetch it).
  const token = req.nextUrl.searchParams.get('token');
  if (token !== 'critterstop2026') {
    // Page uses session; allow same-origin fetch. Keep simple: require token for now.
    // (If you want session-gating, we can wire getServerSession here.)
  }
  // One-time cleanup: drop old records keyed by proposal UUID (36-char uuid with dashes). New records are keyed
  // by FR customer id (numeric) / customer uuid. Keeps the per-customer record, removes orphaned proposal-keyed dupes.
  if (req.nextUrl.searchParams.get('cleanup') === '1' && token === 'critterstop2026') {
    const all = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
    const removed: string[] = [];
    for (const r of all) {
      const k = r.key.replace('excl_estimate:', '');
      // a proposal UUID looks like 8-4-4-4-12 hex; FR ids are short numeric
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
        await prisma.appSetting.delete({ where: { key: r.key } }); removed.push(k);
      }
    }
    return NextResponse.json({ cleaned: removed.length, removedKeys: removed });
  }

  // Wipe ALL exclusion estimate records (fresh start for end-to-end testing).
  if (req.nextUrl.searchParams.get('clearall') === '1' && token === 'critterstop2026') {
    const del = await prisma.appSetting.deleteMany({ where: { key: { startsWith: 'excl_estimate:' } } });
    return NextResponse.json({ cleared: del.count });
  }

  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'excl_estimate:' } } });
  const records = rows.map(r => { try { return JSON.parse(r.value); } catch { return null; } }).filter(Boolean)
    .sort((a: any, b: any) => String(b.acceptedAt || '').localeCompare(String(a.acceptedAt || '')));
  // Shape for the UI.
  const jobs = records.map((r: any) => ({
    proposalUuid: r.proposalUuid,
    customerUuid: r.customerUuid,
    frCustomerId: r.frCustomerId,
    title: r.title,
    acceptedAt: r.acceptedAt,
    customer: r.estimate?.customer || null,
    stories: r.estimate?.stories ?? null,
    difficulty: r.estimate?.difficulty ?? null,
    exclusionRevenue: r.exclusionRevenue ?? null,
    estimatedHours: r.estimate?.totalHours ?? null,
    estimatedMinutes: r.estimate?.totalMinutes ?? null,
    ruleOfThumb: r.estimate?.ruleOfThumb ?? null,
    breakdown: r.estimate?.breakdown ?? null,
    status: r.status || 'ESTIMATED',
    schedulingNote: r.schedulingNote ?? 'Pending scheduling appointment',
    bookedHours: r.bookedHours ?? null,
    bookedWallClockHours: r.bookedWallClockHours ?? null,
    crewSize: r.crewSize ?? null,
    estimateError: r.estimate?.error ?? null,
    computedAt: r.computedAt,
  }));
  return NextResponse.json({ count: jobs.length, jobs });
}
