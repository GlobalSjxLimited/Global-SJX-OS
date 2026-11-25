import { Role } from './roles';

/**
 * Module catalogue. Every page / API area in GLOBAL SJX OS is a module, and
 * roles are tied to the modules they may see (ISO/IEC 27001:2022 A.5.15 access
 * control, A.5.18 access rights). The CEO / administrator can change the module
 * set per role and grant or deny single modules per person on top of that.
 */
export interface ModuleDef {
  key: string;
  label: string;
  group: string;
  path: string;
  description: string;
  /** sensitive modules are flagged in access reviews */
  sensitive?: boolean;
}

export const MODULES: ModuleDef[] = [
  // Workspace
  { key: 'dashboard', label: 'Dashboard', group: 'Workspace', path: '/', description: 'Personal overview' },
  { key: 'hub', label: 'Global SJX Hub', group: 'Workspace', path: '/hub', description: 'Company news, recognition and updates' },
  { key: 'my_work', label: 'My Work', group: 'Workspace', path: '/my-work', description: 'Own tasks, meetings and reminders' },
  { key: 'reminders', label: 'Reminders', group: 'Workspace', path: '/reminders', description: 'Everything due or overdue for you' },
  { key: 'ai', label: 'SJX AI', group: 'Workspace', path: '/ai', description: 'AI assistant' },
  { key: 'settings', label: 'Settings', group: 'Workspace', path: '/settings', description: 'Own profile, security and privacy' },
  // Delivery
  { key: 'tasks', label: 'Tasks', group: 'Delivery', path: '/tasks', description: 'Task board' },
  { key: 'projects', label: 'Projects', group: 'Delivery', path: '/projects', description: 'Project delivery' },
  { key: 'meetings', label: 'Meetings', group: 'Delivery', path: '/meetings', description: 'Meetings and minutes' },
  { key: 'goals', label: 'Goals & OKRs', group: 'Delivery', path: '/goals', description: 'Objectives and key results' },
  { key: 'work_reports', label: 'Work Reports', group: 'Delivery', path: '/work-reports', description: 'Tasks per person, approvals waiting, milestone progress, blockers' },
  { key: 'intake', label: 'E-mail Intake', group: 'Delivery', path: '/intake', description: 'Rules that turn incoming e-mail into tasks', sensitive: true },
  // Revenue
  { key: 'clients', label: 'Clients', group: 'Revenue', path: '/clients', description: 'Client records, contacts and contracts' },
  { key: 'sales', label: 'Sales Pipeline', group: 'Revenue', path: '/sales', description: 'Opportunities' },
  { key: 'vendors', label: 'Vendors', group: 'Revenue', path: '/vendors', description: 'Vendor records' },
  { key: 'sponsors', label: 'Sponsors', group: 'Revenue', path: '/sponsors', description: 'Sponsorships' },
  { key: 'marketing', label: 'Marketing', group: 'Revenue', path: '/marketing', description: 'Campaigns and leads' },
  // Finance
  { key: 'invoices', label: 'Invoices', group: 'Finance', path: '/invoices', description: 'Invoicing, payments and receivables', sensitive: true },
  { key: 'bank_accounts', label: 'Bank Accounts', group: 'Finance', path: '/accounts', description: 'Company bank accounts used on invoices', sensitive: true },
  { key: 'taxes', label: 'Tax, VAT & WHT', group: 'Finance', path: '/taxes', description: 'Tax records, rates, exchange rates and returns', sensitive: true },
  { key: 'expenses', label: 'Expenses', group: 'Finance', path: '/expenses', description: 'Submit and track own expense claims' },
  { key: 'expense_approvals', label: 'Expense Approvals', group: 'Finance', path: '/expenses', description: 'Approve, disburse and see every expense claim', sensitive: true },
  // People
  { key: 'employees', label: 'Employees', group: 'People', path: '/employees', description: 'Employee records and onboarding', sensitive: true },
  { key: 'offboarding', label: 'Offboarding & Asset Returns', group: 'People', path: '/offboarding', description: 'Leaver cases: reclaim assets, hand over tasks, approve returns, revoke access (Return of Asset Policy)', sensitive: true },
  { key: 'employee_sensitive', label: 'Employee payment & personal data', group: 'People', path: '/employees', description: 'Bank/payment details and personal data on employee profiles', sensitive: true },
  { key: 'groups', label: 'Groups', group: 'People', path: '/groups', description: 'Teams and groups' },
  { key: 'training', label: 'Training', group: 'People', path: '/training', description: 'Training courses' },
  { key: 'certifications', label: 'Certifications', group: 'People', path: '/certifications', description: 'Certification tracking' },
  { key: 'skills', label: 'Skills', group: 'People', path: '/skills', description: 'Skills matrix' },
  { key: 'academy', label: 'Academy', group: 'People', path: '/academy', description: 'Global SJX Academy (Beta)' },
  // Knowledge & Risk
  { key: 'documents', label: 'Documents', group: 'Knowledge', path: '/documents', description: 'Document library' },
  { key: 'ideas', label: 'Idea Room', group: 'Knowledge', path: '/ideas', description: 'Ideas and innovation' },
  { key: 'knowledge', label: 'Knowledge Base', group: 'Knowledge', path: '/knowledge', description: 'Articles and insights' },
  { key: 'tickets', label: 'Support Desk', group: 'Knowledge', path: '/tickets', description: 'Support requests' },
  // Security, Risk & Data Protection
  { key: 'security', label: 'Information Security', group: 'Security & Compliance', path: '/security', description: 'Controls register, requirements, suppliers', sensitive: true },
  { key: 'assets', label: 'Asset Inventory', group: 'Security & Compliance', path: '/assets', description: 'Information asset register and lifecycle', sensitive: true },
  { key: 'asset_policy', label: 'Asset Classification Policy', group: 'Security & Compliance', path: '/assets?tab=policy', description: 'Automatic labelling rules, blocked names and minimum classification', sensitive: true },
  { key: 'threat_intel', label: 'Threat Intelligence', group: 'Security & Compliance', path: '/threat-intel', description: 'Collect, analyse and act on threat intelligence; indicators and threat hunting', sensitive: true },
  { key: 'threat_intel_manage', label: 'Threat Intelligence — manage', group: 'Security & Compliance', path: '/threat-intel', description: 'Vet sources, share intelligence externally, see TLP:RED, delete and approve', sensitive: true },
  { key: 'incidents', label: 'Incidents', group: 'Security & Compliance', path: '/incidents', description: 'Security incidents and personal-data breaches', sensitive: true },
  { key: 'data_protection', label: 'Data Protection', group: 'Security & Compliance', path: '/data-protection', description: 'Data subject requests and processing register', sensitive: true },
  { key: 'policies', label: 'Policies', group: 'Security & Compliance', path: '/policies', description: 'Policy library and acknowledgements' },
  { key: 'risks', label: 'Risks', group: 'Security & Compliance', path: '/risks', description: 'Risk register' },
  { key: 'compliance', label: 'Compliance', group: 'Security & Compliance', path: '/compliance', description: 'Compliance items' },
  { key: 'assurance', label: 'Assurance Centre', group: 'Security & Compliance', path: '/assurance', description: 'Scorecard, compliance calendar and reminders', sensitive: true },
  { key: 'reports', label: 'Reports Centre', group: 'Security & Compliance', path: '/reports', description: 'Reports, exports and scheduled delivery', sensitive: true },
  { key: 'audit_log', label: 'Audit Log', group: 'Security & Compliance', path: '/audit', description: 'Tamper-evident activity trail', sensitive: true },
  { key: 'awareness', label: 'Security Awareness', group: 'Workspace', path: '/awareness', description: 'Short role-based questions, quizzes, phishing reporting and the leaderboard' },
  { key: 'isms', label: 'ISMS Automation Hub', group: 'Security & Compliance', path: '/isms', description: 'Registers, automation rules, evidence packs and policy coverage (ISO/IEC 27001)', sensitive: true },
  { key: 'supplier_assessments', label: 'Supplier assessments', group: 'Security & Compliance', path: '/supplier-assessments', description: 'Send security questionnaires to suppliers, score the answers and record the review', sensitive: true },
  { key: 'signatures', label: 'E-signatures', group: 'Security & Compliance', path: '/signatures', description: 'Send documents (NDAs, contracts, supplier terms) to be signed electronically and keep the certificate', sensitive: true },
  { key: 'visitors', label: 'Visitors — reception', group: 'Workspace', path: '/visitors', description: 'Register walk-ins, check visitors in and out, print passes, see who is on site', sensitive: true },
  { key: 'visitors_admin', label: 'Visitors — security & analytics', group: 'Security & Compliance', path: '/visitors', description: 'Watchlist, analytics, evacuation history and host availability for everyone', sensitive: true },
  { key: 'my_visitors', label: 'My visitors', group: 'Workspace', path: '/my-visitors', description: 'Accept or decline visitors and set when people can book to see you' },
  { key: 'access_control', label: 'Access Control', group: 'Security & Compliance', path: '/access', description: 'Roles ↔ modules, overrides and access reviews', sensitive: true },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
export const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.key, m]));

/** Always available to any signed-in internal user — nobody can be locked out of their own profile and reminders. */
export const ALWAYS_ON = ['dashboard', 'settings', 'hub', 'my_work', 'reminders', 'awareness'];

/** Modules only these roles may ever hold (hard ceiling, regardless of configuration). */
export const ADMIN_ONLY_MODULES = ['access_control'];
export const ADMIN_ONLY_ROLES: Role[] = ['super_admin', 'ceo'];

const BASE = [
  ...ALWAYS_ON, 'ai', 'tasks', 'projects', 'meetings', 'goals', 'groups', 'training', 'certifications', 'skills', 'academy',
  'documents', 'ideas', 'knowledge', 'tickets', 'policies', 'expenses', 'my_visitors',
];

export const DEFAULT_ROLE_MODULES: Record<string, string[]> = {
  super_admin: MODULE_KEYS,
  ceo: MODULE_KEYS,
  coo: MODULE_KEYS.filter((k) => !ADMIN_ONLY_MODULES.includes(k)),
  finance: [...BASE, 'clients', 'invoices', 'bank_accounts', 'taxes', 'expense_approvals', 'reports', 'compliance', 'assurance', 'risks'],
  hr: [...BASE, 'employees', 'offboarding', 'employee_sensitive', 'reports', 'data_protection', 'compliance', 'work_reports'],
  sales: [...BASE, 'clients', 'sales', 'vendors', 'sponsors', 'marketing'],
  project_manager: [...BASE, 'clients', 'risks', 'work_reports'],
  engineer: [...BASE, 'assets', 'incidents', 'risks', 'threat_intel'],
  employee: [...BASE],
  // external portal roles — fixed minimal set
  client: ['dashboard', 'academy', 'ai', 'settings'],
  vendor: ['dashboard', 'academy', 'ai', 'settings'],
  training_customer: ['dashboard', 'academy', 'ai', 'settings'],
};

export const EXTERNAL_FIXED = ['client', 'vendor', 'training_customer'];
