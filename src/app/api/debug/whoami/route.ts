import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Temporary diagnostic: returns the current session user so we can see the exact role value.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'no session' }, { status: 401 });
  const u = session.user as any;
  return NextResponse.json({
    email: u.email,
    role: u.role,
    roleType: typeof u.role,
    roleExactMatch_Admin: u.role === 'Admin',
    modules: u.modules ?? null,
  });
}
