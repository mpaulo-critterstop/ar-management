// TEMP: shows the CURRENT logged-in user's access resolution for Stax Payments (helcim).
// Each user hits this themselves (uses their own session) → tells us exactly why they can/can't see the report.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule, canRefund } from '@/lib/access';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  const u = session.user as any;
  return NextResponse.json({
    username: u?.username || u?.name,
    role: u?.role,
    modules: u?.modules || null,
    permissions: u?.permissions || null,
    canSeeStaxModule: canAccessModule(u, 'helcim'),
    canSeeReport: canAccessModule(u, 'helcim'),  // report uses the same gate now
    canRefund: canRefund(u),
  });
}
