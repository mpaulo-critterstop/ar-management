// Shared access-control logic (feature #5). Used server-side (API gating) and client-side (nav hiding).
// Broad tiers via `role`; fine-grained via `modules` allowlist + `permissions` sub-flags + identity links.

export const ALL_MODULES = ['ar', 'dispatch', 'leads', 'csr', 'field-performance', 'dialpad', 'kpi'] as const;
export type ModuleKey = typeof ALL_MODULES[number];

// Roles that see everything regardless of the module allowlist.
const FULL_ACCESS_ROLES = ['ADMIN', 'LEADERSHIP'];

export interface AccessUser {
  role?: string;
  modules?: string[];
  permissions?: any; // { hidePmKpis?, ownDataOnly?, isTeamLeader? }
  pmName?: string | null;
  techId?: string | null;
}

// Does this user have access to a given module?
export function canAccessModule(user: AccessUser | null | undefined, moduleKey: ModuleKey): boolean {
  if (!user) return false;
  if (user.role && FULL_ACCESS_ROLES.includes(user.role)) return true;
  // If no allowlist is set at all, fall back to role-based legacy behavior (don't lock out existing users).
  if (!user.modules || user.modules.length === 0) return legacyRoleAccess(user.role, moduleKey);
  return user.modules.includes(moduleKey);
}

// Legacy fallback: users created before feature #5 have no `modules` — keep their prior access by role.
function legacyRoleAccess(role: string | undefined, moduleKey: ModuleKey): boolean {
  if (!role) return false;
  if (FULL_ACCESS_ROLES.includes(role)) return true;
  // MANAGER historically saw operational modules; COLLECTIONS/ACCOUNTING saw AR; TECHNICIAN saw FP.
  const map: Record<string, ModuleKey[]> = {
    MANAGER: ['ar', 'dispatch', 'leads', 'csr', 'field-performance', 'dialpad', 'kpi'],
    COLLECTIONS: ['ar'],
    ACCOUNTING: ['ar', 'kpi'],
    TECHNICIAN: ['field-performance'],
  };
  return (map[role] || []).includes(moduleKey);
}

// Sub-flag helpers
export function perm(user: AccessUser | null | undefined, flag: 'hidePmKpis' | 'ownDataOnly' | 'isTeamLeader'): boolean {
  return !!(user?.permissions && user.permissions[flag]);
}

// Row-level: should this user's view be restricted to only their own data?
export function isOwnDataOnly(user: AccessUser | null | undefined): boolean {
  if (!user) return true;
  if (user.role && FULL_ACCESS_ROLES.includes(user.role)) return false;
  return perm(user, 'ownDataOnly');
}
