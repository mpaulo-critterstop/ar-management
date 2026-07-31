// Field Performance bonuses — crew-leader and field-professional bonuses paid per month.
// Mirrors the MoM "Bonuses Paid" section of the Excel.
// GET  /api/field-performance/bonuses?year=2026[&office=DFW]  -> { year, months, crewLeader[], fieldPro[] }
// POST /api/field-performance/bonuses  { techId, kind, month, amount, note? }  -> creates one
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'field-performance')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const year = parseInt(req.nextUrl.searchParams.get('year') || '2026');
  const office = req.nextUrl.searchParams.get('office');
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const where: any = { month: { gte: start, lte: end } };
  if (office && office !== 'ALL' && office !== 'ADMIN' && office !== 'All') where.office = office;

  const bonuses = await prisma.bonus.findMany({ where, orderBy: [{ techId: 'asc' }, { month: 'asc' }] });

  // Month-end labels Jan..Dec of the year.
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(year, i + 1, 0)).toISOString().slice(0, 10)
  );
  const monthKey = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  // Pivot into per-person rows with amounts keyed by month-end + a YTD total.
  function pivot(kind: string) {
    const byTech = new Map<string, any>();
    for (const b of bonuses.filter(b => b.kind === kind)) {
      if (!byTech.has(b.techId)) {
        byTech.set(b.techId, {
          techId: b.techId, techName: b.techName, crewLeader: b.crewLeader,
          office: b.office, amounts: {} as Record<string, number>, ytd: 0,
        });
      }
      const row = byTech.get(b.techId);
      const mk = monthKey(new Date(b.month));
      row.amounts[mk] = (row.amounts[mk] || 0) + b.amount;
      row.ytd += b.amount;
    }
    return [...byTech.values()].sort((a, b) => a.techId.localeCompare(b.techId));
  }

  return NextResponse.json({
    year, months,
    crewLeader: pivot('crew_leader'),
    fieldPro: pivot('field_professional'),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role;
  if (!['Admin', 'Manager'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden — Admin/Manager only' }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const { techId, kind, month, amount, note } = b;
  if (!techId || !kind || !month || amount == null) {
    return NextResponse.json({ error: 'techId, kind, month, amount required' }, { status: 400 });
  }
  if (kind !== 'crew_leader' && kind !== 'field_professional') {
    return NextResponse.json({ error: 'kind must be crew_leader or field_professional' }, { status: 400 });
  }

  // Resolve tech details for denormalized display.
  const tech = await prisma.technician.findUnique({ where: { techId } });
  if (!tech) return NextResponse.json({ error: `Unknown techId ${techId}` }, { status: 404 });

  // Normalize month to that month's end (UTC), matching the sheet's column convention.
  const d = new Date(month);
  const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const created = await prisma.bonus.create({
    data: {
      techId, techName: tech.name, crewLeader: tech.crewLeader ?? null,
      office: tech.office, kind, month: monthEnd, amount: Number(amount),
      note: note || null, updatedAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true, bonus: created });
}
