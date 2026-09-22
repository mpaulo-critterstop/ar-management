// One-time list: still-open close-out jobs — DFW trapping jobs that are close-out-eligible (have had trap
// checks) but are NOT closed out as of today. This is the "these should be / could be closed out but aren't"
// worklist Chisam asked for.
//   /api/cron/open-closeout-jobs?token=critterstop2026            (JSON)
//   /api/cron/open-closeout-jobs?token=critterstop2026&office=DFW&minTC=2
//   /api/cron/open-closeout-jobs?token=critterstop2026&csv=1       (CSV for a spreadsheet)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== process.env.CRON_SECRET && sp.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const office = sp.get('office') || 'DFW';
  const minTC = parseInt(sp.get('minTC') || '1'); // min trap checks to count as close-out-eligible (>=1 = has been trap-checked)
  const asCsv = sp.get('csv') === '1';

  // Close-out-eligible but still open: trapping jobs with at least minTC trap checks, not closed out.
  const jobs = await prisma.dispatchJob.findMany({
    where: {
      office,
      hasTrapping: true,
      trapCheckCount: { gte: minTC },
      closedOut: false,
    },
    select: {
      office: true, pmName: true, trapCheckCount: true, trapsDone: true, lastTrapCheck: true, updatedAt: true,
      customer: { select: { name: true, externalId: true, serviceAddr: true } },
    },
    orderBy: [{ trapCheckCount: 'desc' }, { lastTrapCheck: 'asc' }],
  });

  const rows = jobs.map(j => ({
    customer: j.customer?.name || 'Unknown',
    frId: j.customer?.externalId || '',
    office: j.office,
    pm: j.pmName || '',
    trapChecks: j.trapCheckCount,
    trapsDone: j.trapsDone,
    lastTrapCheck: j.lastTrapCheck ? new Date(j.lastTrapCheck).toISOString().slice(0, 10) : '',
    daysSinceLastCheck: j.lastTrapCheck ? Math.floor((Date.now() - new Date(j.lastTrapCheck).getTime()) / 86400000) : null,
    address: j.customer?.serviceAddr || '',
  }));

  if (asCsv) {
    const header = 'Customer,FR ID,Office,PM,Trap Checks,Traps Done,Last Trap Check,Days Since,Address';
    const lines = rows.map(r =>
      [r.customer, r.frId, r.office, r.pm, r.trapChecks, r.trapsDone, r.lastTrapCheck, r.daysSinceLastCheck ?? '', r.address]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
    );
    return new NextResponse([header, ...lines].join('\n'), {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="open-closeout-jobs-${office}.csv"` },
    });
  }

  return NextResponse.json({ office, minTC, total: rows.length, jobs: rows });
}
