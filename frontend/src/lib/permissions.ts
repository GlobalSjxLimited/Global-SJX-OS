import { Role } from '@/types';

export const INTERNAL_ROLES: Role[] = ['super_admin', 'ceo', 'coo', 'finance', 'hr', 'sales', 'project_manager', 'engineer', 'employee'];
export const EXTERNAL_ROLES: Role[] = ['client', 'vendor', 'training_customer'];
export const LEADERSHIP_ROLES: Role[] = ['super_admin', 'ceo', 'coo', 'finance'];

export function isExternalRole(role?: Role): boolean {
  return !!role && EXTERNAL_ROLES.includes(role);
}

/** super_admin always passes, mirroring the backend's requireRole() behaviour. */
function has(role: Role | undefined, allowed: Role[]): boolean {
  if (!role) return false;
  return role === 'super_admin' || allowed.includes(role);
}

export const can = {
  manageEmployees: (role?: Role) => has(role, ['hr', 'coo', 'ceo']),
  manageVendorsSponsors: (role?: Role) => has(role, ['coo', 'ceo', 'sales']),
  manageMarketing: (role?: Role) => has(role, ['sales', 'coo', 'ceo']),
  viewFinance: (role?: Role) => has(role, ['ceo', 'coo', 'finance']),
  manageCompliance: (role?: Role) => has(role, ['coo', 'ceo', 'finance']),
  runAutomation: (role?: Role) => has(role, ['coo', 'ceo']),
  manageAcademyCourses: (role?: Role) => has(role, ['hr', 'coo', 'ceo']),
  /** Create/edit/delete projects — a plain employee can be assigned tasks on a project but can't create or restructure one. */
  manageProjects: (role?: Role) => has(role, ['project_manager', 'coo', 'ceo']),
  /** Create/edit/delete client records themselves (not the same as viewing a client's page, which any internal role can do). */
  manageClients: (role?: Role) => has(role, ['sales', 'coo', 'ceo']),
  /** Contracts carry legal/financial weight — narrower than general client editing. */
  manageContracts: (role?: Role) => has(role, ['sales', 'coo', 'ceo', 'finance']),
  manageOpportunities: (role?: Role) => has(role, ['sales', 'coo', 'ceo']),
};

/**
 * Nav path -> roles allowed to see it. Omit a path to make it visible to every
 * internal role. External portal roles (client/vendor/training_customer) never
 * see anything here — they get the fixed minimal nav below, since none of
 * these internal-operations modules are relevant to an outside party.
 */
export const NAV_ACCESS: Record<string, Role[]> = {
  '/employees': ['hr', 'coo', 'ceo'],
  '/sales': ['sales', 'coo', 'ceo'],
  '/vendors': ['coo', 'ceo', 'sales'],
  '/sponsors': ['coo', 'ceo', 'sales'],
  '/marketing': ['sales', 'coo', 'ceo'],
  '/reports': ['ceo', 'coo', 'finance'],
  '/compliance': ['coo', 'ceo', 'finance'],
  '/risks': ['coo', 'ceo', 'finance', 'project_manager'],
};

export function canSeeNavPath(role: Role | undefined, path: string): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  const allowed = NAV_ACCESS[path];
  return !allowed || allowed.includes(role);
}

export const EXTERNAL_NAV_PATHS = ['/', '/academy', '/ai', '/settings'];

/**
 * Nav path -> module(s) that unlock it. The menu and route guard use the module
 * list the API returns for the signed-in person (role defaults + personal
 * overrides), so access is tied to modules, not hard-coded roles. Paths not
 * listed here are open to every internal user.
 */
export const NAV_MODULE: Record<string, string[]> = {
  '/tasks': ['tasks'], '/projects': ['projects'], '/meetings': ['meetings'], '/goals': ['goals'], '/work-reports': ['work_reports'], '/intake': ['intake'],
  '/clients': ['clients'], '/sales': ['sales'], '/vendors': ['vendors'], '/sponsors': ['sponsors'], '/marketing': ['marketing'],
  '/employees': ['employees'], '/groups': ['groups'], '/training': ['training'], '/certifications': ['certifications'], '/skills': ['skills'], '/academy': ['academy'],
  '/documents': ['documents'], '/ideas': ['ideas'], '/knowledge': ['knowledge'], '/tickets': ['tickets'], '/security': ['security'],
  '/risks': ['risks'], '/compliance': ['compliance'],
  '/expenses': ['expenses', 'expense_approvals'], '/invoices': ['invoices'], '/accounts': ['bank_accounts'], '/taxes': ['taxes'],
  '/assets': ['assets'], '/offboarding': ['offboarding'], '/threat-intel': ['threat_intel'], '/isms': ['isms'], '/incidents': ['incidents'], '/privacy': ['data_protection'], '/visitors': ['visitors', 'visitors_admin'], '/import': ['isms', 'assets', 'policies', 'vendors'], '/signatures': ['signatures'], '/supplier-assessments': ['supplier_assessments', 'isms', 'vendors'], '/my-visitors': ['my_visitors'], '/access': ['access_control'], '/audit': ['audit_log'],
};

/** Module-aware visibility. Falls back to the legacy role table if the API did not send a module list (old cached session). */
export function canSeeNavForUser(user: { role: Role; modules?: string[] } | null | undefined, path: string): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (!user.modules) return canSeeNavPath(user.role, path);
  const needed = NAV_MODULE[path];
  return !needed || needed.some((m) => user.modules!.includes(m));
}
