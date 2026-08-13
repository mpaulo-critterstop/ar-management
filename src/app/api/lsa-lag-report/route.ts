import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildReport, Segment } from '@/lib/lsaLagReport';

export const dynamic = 'force-dynamic';

const SEGMENTS: Segment[] = ['All', 'Wildlife', 'Pest'];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const location = sp.get('location');

  const rows = await prisma.lsaLead.findMany({
    where: { leadType: 'MESSAGE', ...(location && location !== 'All' ? { location } : {}) },
    select: { creationDateTime: true, firstReplyAt: true, lastActivityAt: true, category: true, leadType: true },
  });

  const locRows = await prisma.lsaLead.findMany({ select: { location: true }, distinct: ['location'], orderBy: { location: 'asc' } });
  const locations = locRows.map(r => r.location);

  const build = (period: 'month' | 'week') =>
    Object.fromEntries(SEGMENTS.map(s => [s, buildReport(rows as any, s, period)]));

  return NextResponse.json({
    monthly: build('month'),
    weekly: build('week'),
    locations,
    totalMessageLeads: rows.length,
    generatedAt: new Date().toISOString(),
  });
}
