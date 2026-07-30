// TC Frequency (Avg. Days Between Visits) — reproduces the Excel "TC Frequency" sheet.
// Definition (Excel col L 'Next Visit Days', averaged by month via AVERAGEIFS): for each tracked
// appointment, nextVisitDays = days until the customer's next NON-callback, NON-annual visit within
// 180 days. TC Frequency for a period = AVG(nextVisitDays). The Hub already stores nextVisitDays on
// tc_appointments (verified to match the Excel to 2 decimals), so this is a straight AVG grouped by
// month, plus a year-over-year (month x year) matrix.
//
// GET /api/tc-accountability/frequency?office=DFW|ALL
//   -> { current, monthly: [{month, value, n}], yoy: { years, months, matrix } }
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

  const office = req.nextUrl.searchParams.get('office') || 'ALL';
  const officeFilter = office && office !== 'ALL' && office !== 'ADMIN';

  // Monthly continuous series: AVG(nextVisitDays) per calendar month.
  const monthlyRows: Array<{ month: Date; value: number | null; n: bigint }> = officeFilter
    ? await prisma.$queryRaw`
        SELECT date_trunc('month', "date") AS month,
               AVG("nextVisitDays") AS value,
               COUNT("nextVisitDays") AS n
        FROM "tc_appointments"
        WHERE "nextVisitDays" IS NOT NULL AND office = ${office}
        GROUP BY 1 ORDER BY 1`
    : await prisma.$queryRaw`
        SELECT date_trunc('month', "date") AS month,
               AVG("nextVisitDays") AS value,
               COUNT("nextVisitDays") AS n
        FROM "tc_appointments"
        WHERE "nextVisitDays" IS NOT NULL
        GROUP BY 1 ORDER BY 1`;

  const monthly = monthlyRows.map(r => ({
    month: r.month.toISOString().slice(0, 7), // YYYY-MM
    value: r.value != null ? Math.round(Number(r.value) * 100) / 100 : null,
    n: Number(r.n),
  }));

  // Year-over-year matrix: value per (year, monthNumber 1-12).
  const yoyRows: Array<{ yr: number; mo: number; value: number | null }> = officeFilter
    ? await prisma.$queryRaw`
        SELECT EXTRACT(YEAR FROM "date")::int AS yr,
               EXTRACT(MONTH FROM "date")::int AS mo,
               AVG("nextVisitDays") AS value
        FROM "tc_appointments"
        WHERE "nextVisitDays" IS NOT NULL AND office = ${office}
        GROUP BY 1, 2 ORDER BY 1, 2`
    : await prisma.$queryRaw`
        SELECT EXTRACT(YEAR FROM "date")::int AS yr,
               EXTRACT(MONTH FROM "date")::int AS mo,
               AVG("nextVisitDays") AS value
        FROM "tc_appointments"
        WHERE "nextVisitDays" IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, 2`;

  const years = [...new Set(yoyRows.map(r => r.yr))].sort();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // matrix: one entry per month (1-12), with a value per year — shaped for a multi-line chart.
  const matrix = monthNames.map((name, i) => {
    const row: any = { month: name };
    for (const y of years) {
      const cell = yoyRows.find(r => r.yr === y && r.mo === i + 1);
      row[String(y)] = cell?.value != null ? Math.round(Number(cell.value) * 100) / 100 : null;
    }
    return row;
  });

  // Current = latest month that has a meaningful sample (avoid the trailing incomplete month
  // where future visits aren't booked yet — Excel notes this lag). Use the last month with n >= 20.
  const meaningful = monthly.filter(m => m.n >= 20);
  const current = meaningful.length ? meaningful[meaningful.length - 1] : (monthly[monthly.length - 1] ?? null);

  return NextResponse.json({
    current,                 // { month, value, n } for the tile
    monthly,                 // continuous series
    yoy: { years, matrix },  // year-over-year
    standard: 10,            // Excel Scoreboard standard for TC Frequency
  });
}
