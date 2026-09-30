// International Payroll — PTO API.
//   GET ?year=2026 → { summary: [{name, pto:{allotment,used,remaining}, holiday:{...}}], leaves: [...], allotments: [...] }
//   POST actions: addLeave/updateLeave/deleteLeave, setAllotment
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const year = parseInt(req.nextUrl.searchParams.get('year') || String(new Date().getFullYear()));

  const [allotments, leaves] = await Promise.all([
    prisma.ptoAllotment.findMany({ where: { year }, orderBy: { name: 'asc' } }),
    prisma.ptoLeave.findMany({ where: { year }, orderBy: { startDate: 'desc' } }),
  ]);

  // Used per person per type = sum of businessDays from the log.
  const used = new Map<string, { pto: number; holiday: number }>();
  for (const l of leaves) {
    const cur = used.get(l.name) || { pto: 0, holiday: 0 };
    if (l.leaveType === 'Holiday') cur.holiday += l.businessDays; else cur.pto += l.businessDays;
    used.set(l.name, cur);
  }

  // Everyone with an allotment OR a leave entry.
  const names = new Set<string>([...allotments.map(a => a.name), ...leaves.map(l => l.name)]);
  const summary = [...names].sort().map(name => {
    const a = allotments.find(x => x.name === name);
    const u = used.get(name) || { pto: 0, holiday: 0 };
    const ptoAll = a?.ptoAllotment ?? 0, holAll = a?.holidayAllotment ?? 0;
    return {
      name,
      pto: { allotment: ptoAll, used: u.pto, remaining: Math.round((ptoAll - u.pto) * 100) / 100 },
      holiday: { allotment: holAll, used: u.holiday, remaining: Math.round((holAll - u.holiday) * 100) / 100 },
      notes: a?.notes || null,
    };
  });

  return NextResponse.json({ year, summary, leaves, allotments });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const action = b.action;

  if (action === 'addLeave' || action === 'updateLeave') {
    const data = {
      name: b.name, leaveType: b.leaveType || 'PTO', startDate: new Date(b.startDate), endDate: new Date(b.endDate || b.startDate),
      businessDays: parseFloat(b.businessDays) || 0, notes: b.notes || null, year: b.year || new Date(b.startDate).getFullYear(),
    };
    if (action === 'addLeave') { const r = await prisma.ptoLeave.create({ data }); return NextResponse.json({ ok: true, id: r.id }); }
    await prisma.ptoLeave.update({ where: { id: b.id }, data }); return NextResponse.json({ ok: true });
  }
  if (action === 'deleteLeave') { await prisma.ptoLeave.delete({ where: { id: b.id } }); return NextResponse.json({ ok: true }); }

  if (action === 'setAllotment') {
    const data = { name: b.name, year: b.year, ptoAllotment: parseFloat(b.ptoAllotment) || 0, holidayAllotment: parseFloat(b.holidayAllotment) || 0, notes: b.notes || null };
    await prisma.ptoAllotment.upsert({ where: { name_year: { name: b.name, year: b.year } }, create: data, update: data });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
