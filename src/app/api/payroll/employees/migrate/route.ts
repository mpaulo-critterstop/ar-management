import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// One-time (idempotent) migration: merge ProbationTracker + RaiseTracker + IntlRaiseTracker into the unified
// Employee table, matching the same person by normalized name so we don't create duplicates.
// Pass ?token=critterstop2026 and &dry=1 to preview without writing.

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';

  const [probation, raiseUS, raiseIntl, existing] = await Promise.all([
    prisma.probationTracker.findMany(),
    prisma.raiseTracker.findMany(),
    prisma.intlRaiseTracker.findMany(),
    prisma.employee.findMany(),
  ]);

  // Build a map keyed by normalized name. Start from any employees already migrated (idempotency).
  const byName = new Map<string, any>();
  for (const e of existing) byName.get(norm(e.fullName)) || byName.set(norm(e.fullName), { ...e, _existing: true });

  const upserts: any[] = [];
  const touch = (name: string): any => {
    const k = norm(name);
    if (!byName.has(k)) byName.set(k, { fullName: name.trim(), region: 'US', payType: 'Hourly', active: true, status: 'Active' });
    return byName.get(k);
  };

  // 1) Raise trackers carry pay info (strongest pay source)
  const applyRaise = (r: any, region: string) => {
    const e = touch(r.employeeName);
    e.email = e.email || r.email || null;
    e.department = e.department || r.department || null;
    e.region = region;
    if (r.position && !e.roleCode) e.roleLabel = r.position; // keep raw position in notes-ish; roleCode mapped later
    e.position = r.position || e.position;
    // pay: RaiseTracker.currentSalary + payType('hourly'|'monthly'|'annual')
    const pt = (r.payType || '').toLowerCase();
    if (r.currentSalary != null) {
      if (pt === 'hourly') { e.payType = 'Hourly'; e.hourlyRate = r.currentSalary; }
      else if (pt === 'monthly') { e.payType = 'Salary'; e.annualSalary = r.currentSalary * 12; }
      else { e.payType = 'Salary'; e.annualSalary = r.currentSalary; } // annual
    }
    e.pto = e.pto || r.pto || null;
    e.bonusHistory = e.bonusHistory || r.bonusHistory || null;
    e.mostRecentRaiseDate = e.mostRecentRaiseDate || r.mostRecentRaiseDate || null;
    e.raiseAmount = e.raiseAmount || r.raiseAmount || null;
    e.previousRaiseDate = e.previousRaiseDate || r.previousRaiseDate || null;
    e.previousRaiseAmount = e.previousRaiseAmount || r.previousRaiseAmount || null;
    e.hireDate = e.hireDate || r.startDate || null;
    e.termDate = e.termDate || r.endDate || null;
    if (r.active === false) { e.active = false; e.status = 'Inactive'; }
    e.notes = e.notes || r.notes || null;
    e.srcRaiseId = r.id;
  };
  for (const r of raiseUS) applyRaise(r, 'US');
  for (const r of raiseIntl) applyRaise(r, 'International');

  // 2) Probation trackers carry techId + probation info
  for (const p of probation) {
    const e = touch(p.employeeName);
    e.techId = e.techId || p.techId || null;
    e.hireDate = e.hireDate || p.hireDate || null;
    e.probationEndDate = e.probationEndDate || p.probationEndDate || null;
    e.probationStatus = e.probationStatus || p.status || null;
    e.addedToOnPay = e.addedToOnPay || !!p.addedToOnPay;
    e.addedToOnPayDate = e.addedToOnPayDate || p.addedToOnPayDate || null;
    if (p.active === false) { e.active = false; }
    e.notes = e.notes || p.notes || null;
    e.srcProbationId = p.id;
  }

  // 3) Derive roleCode from techId prefix when possible (W-/P-/I- etc.)
  const prefixRole: Record<string, string> = { W: 'WP', P: 'PMP', I: 'IP' };
  for (const e of byName.values()) {
    if (!e.roleCode && e.techId && /^[A-Za-z]-/.test(e.techId)) {
      const pfx = e.techId[0].toUpperCase();
      if (prefixRole[pfx]) e.roleCode = prefixRole[pfx];
    }
  }

  // Summarize + write
  const rows = [...byName.values()];
  const toCreate = rows.filter(e => !e._existing);
  const toUpdate = rows.filter(e => e._existing);

  if (dry) {
    return NextResponse.json({
      dry: true,
      sources: { probation: probation.length, raiseUS: raiseUS.length, raiseIntl: raiseIntl.length },
      willCreate: toCreate.length, willUpdate: toUpdate.length,
      sample: toCreate.slice(0, 15).map(e => ({ name: e.fullName, techId: e.techId, role: e.roleCode, office: e.office, payType: e.payType, hourly: e.hourlyRate, annual: e.annualSalary, probation: e.probationStatus })),
    });
  }

  let created = 0, updated = 0;
  for (const e of rows) {
    const data: any = {
      techId: e.techId || null, fullName: e.fullName, email: e.email || null,
      roleCode: e.roleCode || null, office: e.office || null, department: e.department || null,
      region: e.region || 'US', hireDate: e.hireDate || null, termDate: e.termDate || null,
      status: e.status || 'Active', active: e.active !== false,
      probationEndDate: e.probationEndDate || null, probationStatus: e.probationStatus || null,
      addedToOnPay: !!e.addedToOnPay, addedToOnPayDate: e.addedToOnPayDate || null,
      payType: e.payType || 'Hourly', hourlyRate: e.hourlyRate ?? null, annualSalary: e.annualSalary ?? null,
      pto: e.pto || null, bonusHistory: e.bonusHistory || null,
      mostRecentRaiseDate: e.mostRecentRaiseDate || null, raiseAmount: e.raiseAmount || null,
      previousRaiseDate: e.previousRaiseDate || null, previousRaiseAmount: e.previousRaiseAmount || null,
      notes: e.notes || null, srcProbationId: e.srcProbationId || null, srcRaiseId: e.srcRaiseId || null,
    };
    if (e._existing) { await prisma.employee.update({ where: { id: e.id }, data }); updated++; }
    else { await prisma.employee.create({ data }); created++; }
  }
  return NextResponse.json({ ok: true, created, updated, total: rows.length });
}
