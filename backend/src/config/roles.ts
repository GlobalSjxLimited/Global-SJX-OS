/**
 * CORE_ROLES are internal Global SJX staff roles.
 * EXTERNAL_ROLES are portal roles for clients, vendors and academy customers —
 * kept on the same User model so the platform can become multi-tenant SaaS
 * later without a schema rewrite (see Organization model).
 */
export const CORE_ROLES = [
  'super_admin',
  'ceo',
  'coo',
  'finance',
  'hr',
  'sales',
  'project_manager',
  'engineer',
  'employee',
] as const;

export const EXTERNAL_ROLES = ['client', 'vendor', 'training_customer'] as const;

export const ALL_ROLES = [...CORE_ROLES, ...EXTERNAL_ROLES] as const;

export type Role = (typeof ALL_ROLES)[number];

/** Roles considered "leadership" for dashboard + escalation routing. */
export const LEADERSHIP_ROLES: Role[] = ['super_admin', 'ceo', 'coo', 'finance'];

/** Roles allowed to manage every internal-operations module. */
export const INTERNAL_STAFF_ROLES: Role[] = [...CORE_ROLES];
