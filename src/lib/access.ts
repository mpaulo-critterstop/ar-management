// Shared access-control logic (feature #5). Used server-side (API gating) and client-side (nav hiding).
// Broad tiers via `role`; fine-grained via `modules` allowlist + `permissions` sub-flags + identity links.

export const ALL_MODULES = ['ar', 'dispatch', 'leads', 'csr', 'field-performance', 'dialpad', 'kpi', 'pest-sales', 'lsa-leads', 'csr-pest-sales'] as const;
export type ModuleKey = typeof ALL_MODULES[number];

// Roles that see every MODULE regardless of the allowlist. Admin and Manager both get all modules;
// the Users admin page is separately gated to Admin-only (see /admin/users), so Managers still can't
// manage users. Keeping Manager here means new modules are visible to managers automatically — no need
// to update a hardcoded list each time a module is added.
const FULL_ACCESS_ROLES = ['Admin', 'Manager'];

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

// Legacy/default fallback: users with no `modules` set get default access by role label.
function legacyRoleAccess(role: string | undefined, moduleKey: ModuleKey): boolean {
  if (!role) return false;
  if (FULL_ACCESS_ROLES.includes(role)) return true;
  // Default module access per role when no explicit allowlist is set.
  const map: Record<string, ModuleKey[]> = {
    Manager: ['ar', 'dispatch', 'leads', 'csr', 'field-performance', 'dialpad', 'kpi'],
    'Accounts Receivable': ['ar', 'kpi'],
    Dispatch: ['dispatch'],
    CSR: ['csr', 'dialpad'],
    'Project Manager': ['leads'],
    Technician: ['field-performance'],
  };
  return (map[role] || []).includes(moduleKey);
}

// Sub-flag helpers
export function perm(user: AccessUser | null | undefined, flag: 'hidePmKpis' | 'hideCommissions' | 'ownDataOnly' | 'isTeamLeader'): boolean {
  return !!(user?.permissions && user.permissions[flag]);
}

// Row-level: should this user's view be restricted to only their own data?
export function isOwnDataOnly(user: AccessUser | null | undefined): boolean {
  if (!user) return true;
  if (user.role && FULL_ACCESS_ROLES.includes(user.role)) return false;
  return perm(user, 'ownDataOnly');
}
