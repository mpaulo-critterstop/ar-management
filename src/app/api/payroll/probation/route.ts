// US Payroll — Probation Tracker API. List + CRUD (deactivate is soft via active flag).
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.probationTracker.findMany({ orderBy: [{ probationEndDate: 'asc' }, { employeeName: 'asc' }] });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();

  const toData = (b: any) => ({
    techId: b.techId || null, employeeName: b.employeeName,
    hireDate: b.hireDate ? new Date(b.hireDate) : null,
    probationEndDate: b.probationEndDate ? new Date(b.probationEndDate) : null,
    status: b.status || 'In probation',
    addedToOnPay: !!b.addedToOnPay, addedToOnPayDate: b.addedToOnPayDate ? new Date(b.addedToOnPayDate) : null,
    notes: b.notes || null, active: b.active !== false,
  });

  if (b.action === 'add') { const r = await prisma.probationTracker.create({ data: toData(b) }); return NextResponse.json({ ok: true, id: r.id }); }
  if (b.action === 'update') { await prisma.probationTracker.update({ where: { id: b.id }, data: toData(b) }); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
