import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule, isOwnDataOnly, perm, type ModuleKey, type AccessUser } from '@/lib/access';

// Server-side gate for API routes. Returns the session user if allowed, or a reason if not.
// Usage:
//   const gate = await guardModule('leads');
//   if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
//   const user = gate.user;  // AccessUser with pmName/techId/permissions for row-level filtering
export async function guardModule(moduleKey: ModuleKey): Promise<
  { ok: true; user: AccessUser & { id: string; email: string } } |
  { ok: false; status: number; error: string }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, status: 401, error: 'Unauthorized' };
  const user = session.user as any;
  if (!canAccessModule(user, moduleKey)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true, user };
}

export { isOwnDataOnly, perm };
