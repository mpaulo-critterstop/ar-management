import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Name-based CSR management. A single CSR may have multiple FR employee IDs (multiple office
// accounts / re-created accounts). This endpoint groups by name so the "Manage CSRs" modal shows
// one row per person, and toggles (isCsr, active) apply to ALL of that person's IDs at once.

// GET: list CSRs grouped by name (only those flagged isCsr=true), plus their combined active state.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await prisma.csrEmployee.findMany({
    where: { isCsr: true },
    orderBy: [{ name: 'asc' }],
  });

  const byName = new Map<string, { name: string; active: boolean; idCount: number }>();
  for (const r of rows) {
    const g = byName.get(r.name) || { name: r.name, active: false, idCount: 0 };
    g.active = g.active || r.active;
    g.idCount += 1;
    byName.set(r.name, g);
  }
  const employees = [...byName.values()].sort((a, b) =>
    (a.active === b.active) ? a.name.localeCompare(b.name) : (a.active ? -1 : 1));

  return NextResponse.json({ employees });
}

// POST: mark a name as a CSR (flip isCsr=true for all IDs with that name).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await req.json();
  if (!name || !name.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const result = await prisma.csrEmployee.updateMany({
    where: { name: name.trim() },
    data: { isCsr: true },
  });

  return NextResponse.json({ updated: result.count, name: name.trim() });
}

// PATCH: toggle active/inactive, or remove-from-CSR, for a whole name.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, active, isCsr } = await req.json();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const result = await prisma.csrEmployee.updateMany({
    where: { name },
    data: {
      ...(active !== undefined && { active }),
      ...(isCsr !== undefined && { isCsr }),
    },
  });

  return NextResponse.json({ updated: result.count });
}
