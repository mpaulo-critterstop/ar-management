// Serves the Pest/Termite Inspection Tracker: the inspection list + a per-PM rollup (inspections, sold,
// close rate), filterable by inspection type and date range.
//   /api/pest-inspections?from=&to=&type=all|Pest|Termite
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const type = sp.get('type'); // 'Pest' | 'Termite' | null(all)
  const office = sp.get('office');

  const where: any = {};
  if (type === 'Pest' || type === 'Termite') where.inspectionType = type;
  if (office && office !== 'All') where.office = office;
  if (from && to) where.inspectionDate = { gte: new Date(from), lte: new Date(to + 'T23:59:59') };

  const rows = await prisma.pestInspection.findMany({
    where,
    orderBy: { inspectionDate: 'desc' },
  });

  // Per-PM rollup.
  const roll: Record<string, { pm: string; pestInsp: number; termiteInsp: number; pestSold: number; termiteSold: number; soldValue: number }> = {};
  const ensure = (pm: string) => (roll[pm] ||= { pm, pestInsp: 0, termiteInsp: 0, pestSold: 0, termiteSold: 0, soldValue: 0 });
  let unattributed = 0;
  for (const r of rows) {
    const pm = r.pmName || null;
    if (!pm) { unattributed++; continue; }
    const s = ensure(pm);
    const isT = r.inspectionType === 'Termite';
    if (isT) s.termiteInsp++; else s.pestInsp++;
    if (r.status === 'SOLD') {
      if (isT) s.termiteSold++; else s.pestSold++;
      s.soldValue += Number(r.soldContractValue || r.soldAmount || 0);
    }
  }
  const byPM = Object.values(roll).map(s => {
    const totalInsp = s.pestInsp + s.termiteInsp;
    const totalSold = s.pestSold + s.termiteSold;
    return {
      pm: s.pm, pestInsp: s.pestInsp, termiteInsp: s.termiteInsp, totalInsp,
      pestSold: s.pestSold, termiteSold: s.termiteSold, totalSold,
      soldValue: s.soldValue,
      closeRate: totalInsp > 0 ? Math.round((totalSold / totalInsp) * 1000) / 10 : null,
    };
  }).sort((a, b) => b.totalInsp - a.totalInsp);

  const totals = {
    inspections: rows.length,
    sold: rows.filter(r => r.status === 'SOLD').length,
    soldValue: rows.reduce((a, r) => a + (r.status === "SOLD" ? Number(r.soldContractValue || r.soldAmount || 0) : 0), 0),
    unattributed,
  };

  return NextResponse.json({
    totals,
    byPM,
    rows: rows.map(r => ({
      id: r.id, office: r.office, customerId: r.customerId, customerName: r.customerName,
      inspectionType: r.inspectionType, serviceTypeName: r.serviceTypeName,
      inspectionDate: r.inspectionDate, pmName: r.pmName, status: r.status,
      soldAmount: r.soldAmount, soldContractValue: r.soldContractValue, soldDate: r.soldDate,
    })),
  });
}
