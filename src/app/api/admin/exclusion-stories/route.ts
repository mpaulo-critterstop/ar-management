// Store/read the exclusion story-count map (FR customerID -> 1 or 2 stories), used by the exclusion-revenue
// report to apply the $225 (1-story) / $175 (2-story) rate standard.
//   POST ?token=critterstop2026  body: { "1380": 1, "2556": 2, ... }   -> merge into stored map
//   GET  ?token=critterstop2026                                         -> read stored map (count + sample)
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
const KEY = 'exclusion_stories_map';

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const existing = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const map: Record<string, number> = existing ? JSON.parse(existing.value) : {};
  let added = 0;
  for (const [cid, st] of Object.entries(body)) {
    const stories = parseInt(String(st)); if (stories !== 1 && stories !== 2) continue;
    map[String(cid).trim()] = stories; added++;
  }
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(map) }, update: { value: JSON.stringify(map) } });
  return NextResponse.json({ ok: true, added, total: Object.keys(map).length });
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const existing = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const map: Record<string, number> = existing ? JSON.parse(existing.value) : {};
  const oneStory = Object.values(map).filter(v => v === 1).length;
  const twoStory = Object.values(map).filter(v => v === 2).length;
  return NextResponse.json({ total: Object.keys(map).length, oneStory, twoStory, sample: Object.fromEntries(Object.entries(map).slice(0, 5)) });
}
