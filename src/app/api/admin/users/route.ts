import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// All user-admin operations require ADMIN.
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if ((session.user as any).role !== 'Admin') return { ok: false as const, status: 403, error: 'Forbidden — Admin only' };
  return { ok: true as const };
}

// GET — list all users (no password hashes).
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: {
      id: true, username: true, email: true, name: true, role: true, office: true,
      modules: true, permissions: true, pmName: true, techId: true, createdAt: true,
    },
  });
  return NextResponse.json(users);
}

// POST — create a user.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const b = await req.json();
  const { username, email, name, password, role, office, modules, permissions, pmName, techId } = b;
  if (!username || !name || !password) return NextResponse.json({ error: 'username, name, password required' }, { status: 400 });

  const uname = String(username).toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { username: uname } });
  if (existing) return NextResponse.json({ error: 'A user with that username already exists' }, { status: 409 });

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username: uname,
      email: email ? String(email).toLowerCase().trim() : null,
      name, password: hashed,
      role: role || 'Accounts Receivable',
      office: office || null,
      modules: Array.isArray(modules) ? modules : [],
      permissions: permissions ?? undefined,
      pmName: pmName || null,
      techId: techId || null,
    },
    select: { id: true, username: true, name: true, role: true, modules: true },
  });
  return NextResponse.json({ success: true, user });
}

// PATCH — update a user's access config (and optionally reset password).
export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const b = await req.json();
  const { id, name, role, office, modules, permissions, pmName, techId, password } = b;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const data: any = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (office !== undefined) data.office = office || null;
  if (modules !== undefined) data.modules = Array.isArray(modules) ? modules : [];
  if (permissions !== undefined) data.permissions = permissions ?? undefined;
  if (pmName !== undefined) data.pmName = pmName || null;
  if (techId !== undefined) data.techId = techId || null;
  if (password) data.password = await bcrypt.hash(password, 10);

  const user = await prisma.user.update({
    where: { id }, data,
    select: { id: true, username: true, email: true, name: true, role: true, modules: true, permissions: true, pmName: true, techId: true },
  });
  return NextResponse.json({ success: true, user });
}

// DELETE — remove a user.
export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  // Don't let an admin delete themselves.
  const session = await getServerSession(authOptions);
  if ((session!.user as any).id === id) return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
