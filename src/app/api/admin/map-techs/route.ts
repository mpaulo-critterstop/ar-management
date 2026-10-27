// One-off/maintenance endpoint to map FR employee IDs -> technician names so reports resolve names
// instead of "FR 10xxx". For each entry: if a Technician already exists with that frEmployeeId, or a name
// match, update it; otherwise create a minimal WP (wildlife) record for the given office.
//   POST ?token=critterstop2026   body: { office?: "DFW", techs: [{ frId:"10953", name:"Mateo Koch" }, ...] }
//   GET  ?token=critterstop2026   -> list current frEmployeeId -> name mappings
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const techs = await prisma.technician.findMany({ where: { frEmployeeId: { not: null } }, select: { frEmployeeId: true, name: true, office: true, team: true }, orderBy: { frEmployeeId: 'asc' } });
  return NextResponse.json({ count: techs.length, techs });
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const office = body.office || 'DFW';
  const list: { frId: string; name: string }[] = body.techs || [];
  const results: any[] = [];

  for (const t of list) {
    const frId = parseInt(String(t.frId));
    if (!frId || !t.name) { results.push({ frId: t.frId, status: 'skipped (bad input)' }); continue; }

    // 1) Already mapped by frEmployeeId?
    const byFr = await prisma.technician.findFirst({ where: { frEmployeeId: frId } });
    if (byFr) {
      if (byFr.name !== t.name) { await prisma.technician.update({ where: { id: byFr.id }, data: { name: t.name } }); results.push({ frId, status: `updated name -> ${t.name}` }); }
      else results.push({ frId, status: 'already mapped' });
      continue;
    }
    // 2) Existing tech with this name but no frEmployeeId? Attach the FR id.
    const byName = await prisma.technician.findFirst({ where: { name: { equals: t.name, mode: 'insensitive' } } });
    if (byName) {
      await prisma.technician.update({ where: { id: byName.id }, data: { frEmployeeId: frId } });
      results.push({ frId, status: `linked to existing tech "${t.name}"` });
      continue;
    }
    // 3) Create a minimal record (WP = wildlife/exclusion team).
    const techId = `fr-${frId}`;
    try {
      await prisma.technician.create({ data: { techId, name: t.name, team: 'WP', office, frEmployeeId: frId, status: 'ACTIVE' } });
      results.push({ frId, status: `created "${t.name}" (WP/${office})` });
    } catch (e: any) {
      results.push({ frId, status: `error: ${String(e).slice(0, 80)}` });
    }
  }
  return NextResponse.json({ ok: true, office, results });
}
