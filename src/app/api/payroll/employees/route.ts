import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Unified Employee API — list + CRUD. Payroll runs hourly; effective hourly for salaried = annual/52/40.
function effHourly(e: { payType?: string | null; hourlyRate?: number | null; annualSalary?: number | null }): number | null {
  if (e.payType === 'Salary') return e.annualSalary != null ? e.annualSalary / 52 / 40 : null;
  return e.hourlyRate ?? null;
}

export async function GET(req: NextRequest) {
  const rows = await prisma.employee.findMany({ orderBy: [{ active: 'desc' }, { fullName: 'asc' }] });
  const now = Date.now();
  const employees = rows.map(e => {
    const eh = effHourly(e);
    const daysSinceRaise = e.mostRecentRaiseDate ? Math.floor((now - new Date(e.mostRecentRaiseDate).getTime()) / 86400000) : null;
    const daysUntilEligible = e.probationEndDate ? Math.ceil((new Date(e.probationEndDate).getTime() - now) / 86400000) : null;
    return { ...e, effHourly: eh, daysSinceRaise, daysUntilEligible };
  });
  // KPI rollups
  const active = employees.filter(e => e.active);
  const kpis = {
    activeTotal: active.length,
    inProbation: active.filter(e => e.probationStatus === 'In probation').length,
    notInOnPay: active.filter(e => e.probationStatus === 'In probation' && !e.addedToOnPay).length,
    fieldTechs: active.filter(e => ['WP', 'PMP', 'IP'].includes(e.roleCode || '')).length,
    officeAdmin: active.filter(e => ['PM', 'M', 'C', 'D', 'AR', 'MKT', 'DE', 'E'].includes(e.roleCode || '')).length,
    raiseDue: active.filter(e => e.daysSinceRaise != null && e.daysSinceRaise >= 90).length,
  };
  return NextResponse.json({ employees, kpis });
}

function toData(b: any) {
  return {
    techId: b.techId || null, fullName: b.fullName, email: b.email || null,
    roleCode: b.roleCode || null, office: b.office || null, department: b.department || null,
    region: b.region || 'US',
    hireDate: b.hireDate ? new Date(b.hireDate) : null,
    termDate: b.termDate ? new Date(b.termDate) : null,
    status: b.status || 'Active', active: b.active !== false,
    probationEndDate: b.probationEndDate ? new Date(b.probationEndDate) : null,
    probationStatus: b.probationStatus || null,
    addedToOnPay: !!b.addedToOnPay,
    addedToOnPayDate: b.addedToOnPayDate ? new Date(b.addedToOnPayDate) : null,
    payType: b.payType || 'Hourly',
    hourlyRate: b.hourlyRate != null && b.hourlyRate !== '' ? Number(b.hourlyRate) : null,
    annualSalary: b.annualSalary != null && b.annualSalary !== '' ? Number(b.annualSalary) : null,
    pto: b.pto || null, bonusHistory: b.bonusHistory || null,
    mostRecentRaiseDate: b.mostRecentRaiseDate ? new Date(b.mostRecentRaiseDate) : null,
    raiseAmount: b.raiseAmount || null,
    previousRaiseDate: b.previousRaiseDate ? new Date(b.previousRaiseDate) : null,
    previousRaiseAmount: b.previousRaiseAmount || null,
    notes: b.notes || null,
  };
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (b.action === 'add') { const r = await prisma.employee.create({ data: toData(b) }); return NextResponse.json({ ok: true, id: r.id }); }
  if (b.action === 'update') { await prisma.employee.update({ where: { id: b.id }, data: toData(b) }); return NextResponse.json({ ok: true }); }
  if (b.action === 'deactivate') { await prisma.employee.update({ where: { id: b.id }, data: { active: false, status: 'Inactive', termDate: b.termDate ? new Date(b.termDate) : new Date() } }); return NextResponse.json({ ok: true }); }
  if (b.action === 'reactivate') { await prisma.employee.update({ where: { id: b.id }, data: { active: true, status: 'Active', termDate: null } }); return NextResponse.json({ ok: true }); }
  if (b.action === 'markOnPay') { await prisma.employee.update({ where: { id: b.id }, data: { addedToOnPay: true, addedToOnPayDate: new Date(), probationStatus: 'Done - added' } }); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
