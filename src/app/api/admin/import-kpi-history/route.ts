// Import locked KPI history rows (Jan-May 2026 from the Leads Tracker Excel, source of truth).
// Freezes those months so the Hub matches the spreadsheet exactly, instead of the incomplete live Lead data.
// POST ?token=critterstop2026  body: { records: [{period,periodKey,scope,booked,leads,closed,closingPct,avgSale,bookedPerLead,cashCollected,bookedPestCV}] }
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.records)) return NextResponse.json({ error: 'need {records:[]}' }, { status: 400 });
  let upserts = 0;
  for (const r of body.records) {
    await prisma.kpiHistory.upsert({
      where: { period_periodKey_scope: { period: r.period, periodKey: r.periodKey, scope: r.scope } },
      create: {
        period: r.period, periodKey: r.periodKey, scope: r.scope,
        booked: r.booked ?? 0, leads: r.leads ?? 0, closed: r.closed ?? 0,
        closingPct: r.closingPct ?? 0, avgSale: r.avgSale ?? 0, bookedPerLead: r.bookedPerLead ?? 0,
        cashCollected: r.cashCollected ?? null, bookedPestCV: r.bookedPestCV ?? null, yoy: r.yoy ?? null,
      },
      update: {
        booked: r.booked ?? 0, leads: r.leads ?? 0, closed: r.closed ?? 0,
        closingPct: r.closingPct ?? 0, avgSale: r.avgSale ?? 0, bookedPerLead: r.bookedPerLead ?? 0,
        cashCollected: r.cashCollected ?? null, bookedPestCV: r.bookedPestCV ?? null, yoy: r.yoy ?? null,
      },
    });
    upserts++;
  }
  return NextResponse.json({ ok: true, upserts });
}

// GET to verify what's stored for 2026
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.kpiHistory.findMany({ where: { period: 'monthly', periodKey: { startsWith: '2026-0' } }, orderBy: [{ periodKey: 'asc' }, { scope: 'asc' }] });
  return NextResponse.json({ count: rows.length, rows });
}
