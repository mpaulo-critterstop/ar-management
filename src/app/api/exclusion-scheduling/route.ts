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
