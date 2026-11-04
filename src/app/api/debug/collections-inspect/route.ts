// TEMP: inspect + optionally repair Collections rows with bad engagement dates (negative/expired countdowns
// from corrupt respondedAt/promisedAt). GET ?token=critterstop2026  (inspect)  | &repair=1 (clear bad engagement)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getConfig, computeCountdownEnd, daysBetween } from '@/lib/collectionsRules';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const repair = req.nextUrl.searchParams.get('repair') === '1';
  const cfg = await getConfig();
  const now = new Date();

  const rows = await prisma.collectionsTracker.findMany({
    where: { stage: { in: ['COUNTDOWN', 'FINAL_WARNING'] } },
    select: { id: true, invoiceNumber: true, customerName: true, enteredAt: true, respondedAt: true, promisedAt: true, respondedLoggedAt: true, promisedLoggedAt: true, countdownEnd: true, stage: true },
  });

  const bad: any[] = [];
  for (const r of rows) {
    const deadline = computeCountdownEnd(cfg, r.enteredAt, r.respondedAt, r.promisedAt);
    const daysLeft = daysBetween(now, deadline);
    const respBad = r.respondedAt && r.enteredAt && new Date(r.respondedAt) < new Date(r.enteredAt);
    const promBad = r.promisedAt && r.enteredAt && new Date(r.promisedAt) < new Date(r.enteredAt);
    const expiredViaEngagement = daysLeft < -1;
    if (respBad || promBad || expiredViaEngagement) {
      bad.push({ id: r.id, invoice: r.invoiceNumber, customer: r.customerName, enteredAt: r.enteredAt, respondedAt: r.respondedAt, promisedAt: r.promisedAt, daysLeft, respBad, promBad });
    }
  }

  if (repair) {
    let fixed = 0;
    for (const b of bad) {
      const freshEntry = new Date();
      await prisma.collectionsTracker.update({
        where: { id: b.id },
        data: { respondedAt: null, respondedLoggedAt: null, promisedAt: null, promisedLoggedAt: null,
          enteredAt: freshEntry, countdownEnd: computeCountdownEnd(cfg, freshEntry, null, null), stage: 'COUNTDOWN' },
      });
      fixed++;
    }
    return NextResponse.json({ repaired: fixed, rows: bad });
  }

  return NextResponse.json({ badCount: bad.length, rows: bad });
}
