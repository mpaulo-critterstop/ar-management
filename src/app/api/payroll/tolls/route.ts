// US Payroll — Tolls API.
//   GET  ?action=plates                 → the plate→tech registry
//   POST { action: 'compute', rows }    → match uploaded toll rows to techs by plate, return per-tech totals
//   POST { action: 'save', ... }        → persist a computed period
//   POST { action: 'addPlate'|'updatePlate'|'deletePlate', ... } → manage the registry
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Normalize a plate for matching: uppercase, strip "TX -"/"TX-" prefix and all spaces.
function normPlate(p: string): string {
  return String(p || '').toUpperCase().replace(/TX\s*-/, '').replace(/\s+/g, '').trim();
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as any)?.role !== 'Admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  const action = req.nextUrl.searchParams.get('action');

  if (action === 'plates') {
    const plates = await prisma.tollPlate.findMany({ orderBy: { tech: 'asc' } });
    return NextResponse.json({ plates });
  }
  if (action === 'periods') {
    const periods = await prisma.tollPeriod.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return NextResponse.json({ periods });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as any)?.role !== 'Admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  const body = await req.json();
  const action = body.action;

  // Compute per-tech tolls from uploaded rows. rows: [{ plate, amount, date }]
  if (action === 'compute') {
    const rows: any[] = body.rows || [];
    const plates = await prisma.tollPlate.findMany({ where: { active: true } });
    const reg = new Map<string, string>();
    for (const p of plates) reg.set(p.plate, p.tech);

    const perTech = new Map<string, { tech: string; amount: number; count: number }>();
    const unmatched = new Map<string, { plate: string; amount: number; count: number }>();
    let total = 0, matched = 0, unm = 0;
    let minDate: string | null = null, maxDate: string | null = null;

    for (const r of rows) {
      const amt = parseFloat(String(r.amount).replace(/[^0-9.\-]/g, ''));
      if (isNaN(amt)) continue;
      total += amt;
      if (r.date) {
        const s = String(r.date).trim();
        let iso = '';
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) iso = `${m[1]}-${m[2]}-${m[3]}`;
        else { m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
        if (iso) { if (!minDate || iso < minDate) minDate = iso; if (!maxDate || iso > maxDate) maxDate = iso; }
      }
      const key = normPlate(r.plate);
      const tech = key ? reg.get(key) : undefined;
      if (tech) {
        const cur = perTech.get(tech) || { tech, amount: 0, count: 0 };
        cur.amount += amt; cur.count++; perTech.set(tech, cur); matched++;
      } else {
        const pk = String(r.plate || '(blank)');
        const cur = unmatched.get(pk) || { plate: pk, amount: 0, count: 0 };
        cur.amount += amt; cur.count++; unmatched.set(pk, cur); unm++;
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const perTechArr = [...perTech.values()].map(t => ({ ...t, amount: round(t.amount) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const unmatchedArr = [...unmatched.values()].map(u => ({ ...u, amount: round(u.amount) }));

    return NextResponse.json({
      total: round(total), matched, unmatched: unm, rawRowCount: rows.length,
      periodStart: minDate, periodEnd: maxDate,
      perTech: perTechArr, unmatchedList: unmatchedArr,
    });
  }

  // Persist a computed period, keyed by payDate (Monday after the Mon-Sun period). Re-saving the same week
  // REPLACES it (re-upload = authoritative version for that week).
  if (action === 'save') {
    if (!body.payDate) return NextResponse.json({ error: 'payDate required' }, { status: 400 });
    const data = {
      payDate: body.payDate, label: body.label || body.payDate,
      periodStart: body.periodStart ? new Date(body.periodStart) : null,
      periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
      totalAmount: body.total || 0, matchedRows: body.matched || 0, unmatchedRows: body.unmatched || 0,
      perTech: body.perTech || [], unmatched: body.unmatchedList || [], rawRowCount: body.rawRowCount || 0,
      uploadedBy: (session.user as any)?.name || null,
    };
    const p = await prisma.tollPeriod.upsert({ where: { payDate: body.payDate }, create: data, update: data });
    return NextResponse.json({ ok: true, id: p.id, payDate: p.payDate });
  }

  // Get one saved period by payDate (for the tracker / history view).
  if (action === 'getPeriod') {
    const p = await prisma.tollPeriod.findUnique({ where: { payDate: body.payDate } });
    return NextResponse.json({ period: p });
  }

  // Registry management.
  if (action === 'addPlate' || action === 'updatePlate') {
    const norm = normPlate(body.plateRaw);
    const data = { plate: norm, plateRaw: body.plateRaw, tech: body.tech, vehicle: body.vehicle || null, tollTag: body.tollTag || null, active: body.active !== false };
    if (action === 'addPlate') {
      const created = await prisma.tollPlate.upsert({ where: { plate: norm }, create: data, update: data });
      return NextResponse.json({ ok: true, id: created.id });
    }
    await prisma.tollPlate.update({ where: { id: body.id }, data });
    return NextResponse.json({ ok: true });
  }
  if (action === 'deletePlate') {
    await prisma.tollPlate.delete({ where: { id: body.id } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
