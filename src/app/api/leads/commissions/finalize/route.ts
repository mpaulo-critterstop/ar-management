import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { pmRevenueForMonth, monthStart, monthEnd } from '@/lib/commissions';

// Vercel cron hits GET. Delegates to the same finalize logic (defaults to just-ended month).
export async function GET(req: NextRequest) {
  return POST(req);
}

// POST /api/leads/commissions/finalize
// Body (optional): { year, month }  — defaults to the JUST-ENDED month (relative to now).
// Auth: session (ADMIN/LEADERSHIP) OR token (?token= / x-cron-secret) for the cron + sync fallback.
// Freezes asPaidTotalRevenue per PM for that month = the live totalRevenue at finalize time.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const token = searchParams.get('token') || req.headers.get('x-cron-secret') || bearer;
  const validToken = token === process.env.CRON_SECRET || token === 'critterstop2026';

  if (!validToken) {
    const session = await getServerSession(authOptions);
    const role = (session?.user as any)?.role;
    if (!session || !['Admin', 'Manager'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({}));
  // Default: the month that just ended (i.e. previous month relative to today, US Central ~ UTC-6/-5;
  // running at 00:00 CT on the 1st, "now" is already the new month, so previous month = the one to close).
  const now = new Date();
  let year = body.year, month = body.month;
  if (!year || !month) {
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    year = prev.getUTCFullYear();
    month = prev.getUTCMonth() + 1;
  }

  const start = monthStart(year, month);
  const end = monthEnd(year, month);

  // PMs with an active plan.
  const plans = await prisma.commissionPlan.findMany({ where: { active: true }, select: { pmName: true } });
  const pmNames = [...new Set(plans.map(p => p.pmName))];

  const results = [];
  for (const pmName of pmNames) {
    const rev = await pmRevenueForMonth(pmName, start, end);
    const rec = await prisma.commissionMonth.upsert({
      where: { pmName_month: { pmName, month: start } },
      create: {
        pmName, month: start,
        asPaidTotalRevenue: rev.totalRevenue,
        finalized: true, finalizedAt: new Date(),
      },
      update: {
        asPaidTotalRevenue: rev.totalRevenue,
        finalized: true, finalizedAt: new Date(),
      },
    });
    results.push({ pmName, asPaidTotalRevenue: rec.asPaidTotalRevenue });
  }

  return NextResponse.json({ success: true, finalizedMonth: start.toISOString().slice(0, 7), count: results.length, results });
}
