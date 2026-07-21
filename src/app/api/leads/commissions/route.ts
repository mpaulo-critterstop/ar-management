import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { computeCommission, monthStart } from '@/lib/commissions';

// GET /api/leads/commissions?year=2026&month=6[&pm=Jordan Price]
// Returns computed commission breakdown for all PMs with a plan (or one PM) for the month.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = Number(searchParams.get('year')) || now.getUTCFullYear();
  const month = Number(searchParams.get('month')) || (now.getUTCMonth() + 1);
  const pmParam = searchParams.get('pm') || undefined;

  // PM set = everyone who has a commission plan (optionally filtered to one).
  const plans = await prisma.commissionPlan.findMany({
    where: { active: true, ...(pmParam ? { pmName: pmParam } : {}) },
    select: { pmName: true },
  });
  const pmNames = [...new Set(plans.map(p => p.pmName))];

  const rows = [];
  for (const pmName of pmNames) {
    rows.push(await computeCommission(pmName, year, month));
  }
  rows.sort((a, b) => b.totalCommission - a.totalCommission);

  return NextResponse.json({ year, month, rows });
}

// PATCH /api/leads/commissions  { pmName, year, month, pestControlComm?, otherAdjustment?, otherAdjNote? }
// Upserts the editable manual inputs for a PM-month. Does NOT touch the finalized snapshot.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role;
  if (!['ADMIN', 'LEADERSHIP'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { pmName, year, month, pestControlComm, otherAdjustment, otherAdjNote } = body;
  if (!pmName || !year || !month) return NextResponse.json({ error: 'pmName, year, month required' }, { status: 400 });

  const mStart = monthStart(year, month);
  const data: any = {};
  if (pestControlComm !== undefined) data.pestControlComm = Number(pestControlComm) || 0;
  if (otherAdjustment !== undefined) data.otherAdjustment = Number(otherAdjustment) || 0;
  if (otherAdjNote !== undefined) data.otherAdjNote = otherAdjNote || null;

  const record = await prisma.commissionMonth.upsert({
    where: { pmName_month: { pmName, month: mStart } },
    create: { pmName, month: mStart, ...data },
    update: data,
  });
  return NextResponse.json({ success: true, record });
}
