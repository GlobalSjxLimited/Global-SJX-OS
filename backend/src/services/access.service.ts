import { ADMIN_ONLY_MODULES, ADMIN_ONLY_ROLES, ALWAYS_ON, DEFAULT_ROLE_MODULES, EXTERNAL_FIXED, MODULE_KEYS } from '../config/modules';
import { RoleModuleConfig } from '../models/Access';
import { User } from '../models/User';

const cache = new Map<string, { at: number; modules: string[] | null }>();
const TTL = 20_000;

export function invalidateAccessCache() {
  cache.clear();
}

async function roleModules(organizationId: string, role: string): Promise<string[]> {
  const key = `${organizationId}:${role}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.modules ?? DEFAULT_ROLE_MODULES[role] ?? [];
  const cfg = await RoleModuleConfig.findOne({ organizationId, role }).lean();
  cache.set(key, { at: Date.now(), modules: cfg ? (cfg.modules as string[]) : null });
  return cfg ? (cfg.modules as string[]) : DEFAULT_ROLE_MODULES[role] ?? [];
}

/** Role defaults (or the org's customised set) + per-person grants − per-person denials. super_admin always has everything. */
export async function effectiveModules(u: { role: string; organizationId: string; moduleGrant?: string[]; moduleDeny?: string[] }): Promise<string[]> {
  if (u.role === 'super_admin') return [...MODULE_KEYS];
  if (EXTERNAL_FIXED.includes(u.role)) return [...(DEFAULT_ROLE_MODULES[u.role] || [])];
  const set = new Set<string>(await roleModules(String(u.organizationId), u.role));
  (u.moduleGrant || []).forEach((m) => set.add(m));
  (u.moduleDeny || []).forEach((m) => set.delete(m));
  ALWAYS_ON.forEach((m) => set.add(m));
  if (!ADMIN_ONLY_ROLES.includes(u.role as any)) ADMIN_ONLY_MODULES.forEach((m) => set.delete(m));
  return MODULE_KEYS.filter((k) => set.has(k));
}

/** Active users in the organisation who hold a given module — used to route e-mails and reminders (e.g. expense approvers). */
export async function usersWithModule(organizationId: string, ...modules: string[]) {
  const users = await User.find({ organizationId, isActive: true, loginEnabled: { $ne: false } }).select('name email role moduleGrant moduleDeny organizationId');
  const out: typeof users = [];
  for (const u of users) {
    const mods = await effectiveModules({ role: u.role, organizationId: String(u.organizationId), moduleGrant: u.moduleGrant as string[], moduleDeny: u.moduleDeny as string[] });
    if (modules.some((m) => mods.includes(m))) out.push(u);
  }
  return out;
}
