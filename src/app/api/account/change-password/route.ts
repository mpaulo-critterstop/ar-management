import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// POST /api/account/change-password  { currentPassword?, newPassword }
// A logged-in user sets a new password. If they're in must-change state, currentPassword isn't required
// (they may only know the temp password, which they're replacing). Clears mustChangePassword.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any).id;

  const { currentPassword, newPassword } = await req.json();
  if (!newPassword || String(newPassword).length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // If NOT in forced-change state, require the current password to be verified.
  if (!user.mustChangePassword) {
    if (!currentPassword) return NextResponse.json({ error: 'Current password required' }, { status: 400 });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed, mustChangePassword: false },
  });

  return NextResponse.json({ success: true });
}
