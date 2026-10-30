// Import the attendance "present" set (techname|date) + tracked-tech list into appSetting, so the exclusion-
// revenue engine can drop phantom crew (tracked tech on a route but not clocked in / no attendance that day).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.present) || !Array.isArray(body.tracked)) return NextResponse.json({ error: 'need {present:[], tracked:[]}' }, { status: 400 });
  await prisma.appSetting.upsert({
    where: { key: 'excl_attendance_present' },
    create: { key: 'excl_attendance_present', value: JSON.stringify({ present: body.present, tracked: body.tracked, builtAt: new Date().toISOString() }) },
    update: { value: JSON.stringify({ present: body.present, tracked: body.tracked, builtAt: new Date().toISOString() }) },
  });
  return NextResponse.json({ ok: true, present: body.present.length, tracked: body.tracked.length });
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await prisma.appSetting.findUnique({ where: { key: 'excl_attendance_present' } });
  if (!row) return NextResponse.json({ present: 0, tracked: 0 });
  const d = JSON.parse(row.value);
  return NextResponse.json({ present: d.present?.length || 0, tracked: d.tracked?.length || 0, builtAt: d.builtAt });
}
