// US Payroll — Raise Tracker API. List + create/update/delete employee pay + raise records.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.raiseTracker.findMany({ orderBy: [{ department: 'asc' }, { employeeName: 'asc' }] });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const action = body.action;

  const toData = (b: any) => ({
    employeeName: b.employeeName, email: b.email || null, department: b.department || null, position: b.position || null,
    startDate: b.startDate ? new Date(b.startDate) : null, endDate: b.endDate ? new Date(b.endDate) : null,
    currentSalary: b.currentSalary != null && b.currentSalary !== '' ? parseFloat(b.currentSalary) : null,
    payType: b.payType || 'hourly', pto: b.pto || null, bonusHistory: b.bonusHistory || null,
    mostRecentRaiseDate: b.mostRecentRaiseDate ? new Date(b.mostRecentRaiseDate) : null, raiseAmount: b.raiseAmount || null,
    previousRaiseDate: b.previousRaiseDate ? new Date(b.previousRaiseDate) : null, previousRaiseAmount: b.previousRaiseAmount || null,
    notes: b.notes || null, active: b.active !== false,
  });

  if (action === 'add') { const r = await prisma.raiseTracker.create({ data: toData(body) }); return NextResponse.json({ ok: true, id: r.id }); }
  if (action === 'update') { await prisma.raiseTracker.update({ where: { id: body.id }, data: toData(body) }); return NextResponse.json({ ok: true }); }
  if (action === 'delete') { await prisma.raiseTracker.delete({ where: { id: body.id } }); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
