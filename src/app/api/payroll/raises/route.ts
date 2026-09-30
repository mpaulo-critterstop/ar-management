// Employee and Raise Tracker API — US and International are SEPARATE tables.
//   GET ?region=US|International → that table's rows
//   POST { action, region, ... } → CRUD against that table
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const model = (region: string) => (region === 'International' ? prisma.intlRaiseTracker : prisma.raiseTracker) as any;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const region = req.nextUrl.searchParams.get('region') || 'US';
  const rows = await model(region).findMany({ orderBy: [{ department: 'asc' }, { employeeName: 'asc' }] });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const m = model(b.region || 'US');

  const toData = (b: any) => ({
    employeeName: b.employeeName, email: b.email || null, department: b.department || null, position: b.position || null,
    startDate: b.startDate ? new Date(b.startDate) : null, endDate: b.endDate ? new Date(b.endDate) : null,
    currentSalary: b.currentSalary != null && b.currentSalary !== '' ? parseFloat(b.currentSalary) : null,
    payType: b.payType || (b.region === 'International' ? 'monthly' : 'hourly'), pto: b.pto || null, bonusHistory: b.bonusHistory || null,
    mostRecentRaiseDate: b.mostRecentRaiseDate ? new Date(b.mostRecentRaiseDate) : null, raiseAmount: b.raiseAmount || null,
    previousRaiseDate: b.previousRaiseDate ? new Date(b.previousRaiseDate) : null, previousRaiseAmount: b.previousRaiseAmount || null,
    notes: b.notes || null, active: b.active !== false,
  });

  if (b.action === 'add') { const r = await m.create({ data: toData(b) }); return NextResponse.json({ ok: true, id: r.id }); }
  if (b.action === 'update') { await m.update({ where: { id: b.id }, data: toData(b) }); return NextResponse.json({ ok: true }); }
  if (b.action === 'delete') { await m.delete({ where: { id: b.id } }); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
