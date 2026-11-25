import { SecurityControl } from '../models/Security';
import { logger } from '../utils/logger';

interface Seed {
  ref: string;
  title: string;
  statement: string;
  domain: 'Secure Development' | 'Access Control' | 'Operations' | 'Data Protection' | 'Supplier' | 'Privacy' | 'Resilience';
  status: 'implemented' | 'in_progress';
  automated: boolean;
  implementation: string;
}

const li = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

export const CONTROL_SEEDS: Seed[] = [
  {
    ref: 'A.8.25',
    title: 'Secure development life cycle',
    statement: 'Rules for the secure development of software and systems shall be established and applied.',
    domain: 'Secure Development',
    status: 'implemented',
    automated: false,
    implementation: li([
      'Written Secure Development Policy (see Knowledge Base › Policies) applies to all in-house and outsourced code.',
      'All changes go through pull request, mandatory review, and the CI pipeline (<code>.github/workflows/ci.yml</code>): type-check, build, tests, dependency audit.',
      'Main branch is protected; no direct pushes; releases are tagged and deployed only from CI.',
      'Security requirements are approved before build (A.8.26) and tested before release (A.8.29).',
    ]),
  },
  {
    ref: 'A.8.26',
    title: 'Application security requirements',
    statement: 'Information security requirements shall be identified, specified and approved when developing or acquiring applications.',
    domain: 'Secure Development',
    status: 'implemented',
    automated: true,
    implementation: li([
      'The <strong>Security Requirements</strong> register in this module captures each requirement per application (develop or acquire).',
      'Workflow: draft → submitted → <em>approved by CEO / COO / admin</em> → verified with evidence. The requester cannot approve their own requirement.',
      'Acquisitions require supplier due-diligence (see Outsourced Development register).',
    ]),
  },
  {
    ref: 'A.8.27',
    title: 'Secure system architecture and engineering principles',
    statement: 'Principles for engineering secure systems shall be established, documented, maintained and applied to any information system development activities.',
    domain: 'Secure Development',
    status: 'implemented',
    automated: true,
    implementation: li([
      '<strong>Defence in depth:</strong> helmet + CSP, rate limiting, input sanitisation, schema validation, RBAC, tenant scoping on every query.',
      '<strong>Least privilege:</strong> role guards on every write route; Support Desk actions restricted to CEO and administrators.',
      '<strong>Secure by default / fail closed:</strong> self-registration disabled; production refuses to start with weak secrets.',
      '<strong>Tenant isolation:</strong> every document carries <code>organizationId</code>; all queries filter on it.',
      '<strong>Minimise attack surface:</strong> auth-gated file serving, no directory listing, SVG uploads rejected.',
      '<strong>Complete mediation and auditability:</strong> security-relevant events are written to the audit log.',
    ]),
  },
  {
    ref: 'A.8.28',
    title: 'Secure coding',
    statement: 'Secure coding principles shall be applied to software development.',
    domain: 'Secure Development',
    status: 'implemented',
    automated: true,
    implementation: li([
      '<strong>SC-01</strong> Validate all external input with schemas (zod) at the boundary.',
      '<strong>SC-02</strong> NoSQL-injection and prototype-pollution keys are stripped from every request (<code>sanitizeInput</code>).',
      '<strong>SC-03</strong> Mass-assignment protection: protected fields (<code>organizationId</code>, <code>isDeleted</code>, role, …) cannot be set by clients.',
      '<strong>SC-04</strong> Every user-supplied regular expression is escaped (ReDoS fix); parameterised queries only.',
      '<strong>SC-05</strong> Passwords hashed with bcrypt; 12+ char policy; account lockout.',
      '<strong>SC-06</strong> Rich text is sanitised (DOMPurify) before it is rendered; no <code>eval</code>, no inline event handlers.',
      '<strong>SC-07</strong> No secrets in source; configuration comes from the environment and is validated at start-up.',
      '<strong>SC-08</strong> Errors never leak stack traces in production.',
    ]),
  },
  {
    ref: 'A.8.29',
    title: 'Security testing in development and acceptance',
    statement: 'Security testing processes shall be defined and implemented in the development life cycle.',
    domain: 'Secure Development',
    status: 'implemented',
    automated: true,
    implementation: li([
      'CI runs on every pull request: strict TypeScript compile, production build, <code>npm audit --audit-level=high</code> for both packages, and a secret scan.',
      'Backend security unit tests (<code>npm test</code>) cover the sanitiser, password policy and environment guards.',
      'Pre-release checklist: dependency review, authentication / authorisation regression, upload tests, and a manual review of new endpoints.',
      'Annual third-party penetration test; findings tracked as risks.',
    ]),
  },
  {
    ref: 'A.8.30',
    title: 'Outsourced development',
    statement: 'The organization shall direct, monitor and review the activities related to outsourced system development.',
    domain: 'Supplier',
    status: 'implemented',
    automated: false,
    implementation: li([
      'The <strong>Outsourced Development</strong> register records each supplier, scope, contract, security clauses, right-to-audit, NDA, ownership of code and test evidence.',
      'Every supplier has an owner and a next-review date; overdue reviews appear on the Security dashboard.',
      'Outsourced code must pass the same CI gates and review before merge.',
    ]),
  },
  {
    ref: 'A.8.31',
    title: 'Separation of development, test and production environments',
    statement: 'Development, testing and production environments shall be separated and secured.',
    domain: 'Operations',
    status: 'implemented',
    automated: true,
    implementation: li([
      '<code>APP_ENV</code> selects development / test / staging / production; each uses its own database, secrets and allowed origins.',
      'Production and staging <strong>refuse to start</strong> with default secrets, localhost origins, or a database name that looks like another environment.',
      'The seed / wipe script is blocked in production and requires <code>ALLOW_SEED=true</code> elsewhere; it never runs automatically.',
      '<code>docker-compose.yml</code> provides isolated dev, test and prod-like stacks with separate volumes and networks.',
      'The Environment panel on the Security page shows the live separation checks.',
    ]),
  },
  {
    ref: 'A.8.33',
    title: 'Test information',
    statement: 'Test information shall be appropriately selected, protected and managed.',
    domain: 'Data Protection',
    status: 'implemented',
    automated: true,
    implementation: li([
      'Non-production environments use <strong>synthetic seed data only</strong>; production data is never copied to dev/test.',
      'If a production extract is ever required it must be approved, masked, access-restricted and deleted after use (documented in the Test Data Procedure).',
      'Seed data uses fictional contacts and reserved domains; test databases are ephemeral (in-memory).',
    ]),
  },
  {
    ref: 'A.5.15',
    title: 'Access control',
    statement: 'Rules to control physical and logical access to information and other associated assets shall be established and implemented based on business and information security requirements.',
    domain: 'Access Control',
    status: 'implemented',
    automated: true,
    implementation: li(['Role-based access control mirrored on server and client.', 'External roles (client, vendor, training customer) are confined to their organisation.', 'Admin-only actions (Support Desk, website publishing, security register) check the role on the server.']),
  },
  {
    ref: 'A.8.5',
    title: 'Secure authentication',
    statement: 'Secure authentication technologies and procedures shall be implemented based on information access restrictions and the topic-specific policy on access control.',
    domain: 'Access Control',
    status: 'implemented',
    automated: true,
    implementation: li(['TOTP multi-factor authentication.', 'Account lockout after repeated failures (configurable).', 'Strict login rate limiting.', 'Password policy and change-password flow; all sessions revoked on change.']),
  },
  {
    ref: 'A.5.17',
    title: 'Session management and revocation',
    statement: 'Authentication information shall be controlled by an allocation and management process.',
    domain: 'Access Control',
    status: 'implemented',
    automated: true,
    implementation: li(['Signed tokens carry a version; "Sign out everywhere" and password change invalidate all prior tokens immediately.']),
  },
  {
    ref: 'A.8.15',
    title: 'Logging',
    statement: 'Logs that record activities, exceptions, faults and other relevant events shall be produced, stored, protected and analysed.',
    domain: 'Operations',
    status: 'implemented',
    automated: true,
    implementation: li(['Audit log of sign-ins, failures, lockouts, MFA changes, password changes, publishing and security decisions.', 'Admin audit-log viewer on the Security page.', 'Request IDs on every request for correlation.']),
  },
  {
    ref: 'A.8.24',
    title: 'Use of cryptography',
    statement: 'Rules for the effective use of cryptography, including cryptographic key management, shall be defined and implemented.',
    domain: 'Data Protection',
    status: 'in_progress',
    automated: false,
    implementation: li(['TLS terminated at the reverse proxy (HSTS enabled in production).', 'Passwords: bcrypt cost 12.', 'Database and backup encryption at rest to be enabled at the hosting layer (open action).']),
  },
  {
    ref: 'A.8.13',
    title: 'Information backup',
    statement: 'Backup copies of information, software and systems shall be maintained and regularly tested.',
    domain: 'Resilience',
    status: 'in_progress',
    automated: false,
    implementation: li(['Daily MongoDB dump procedure documented in the README; restore test to be scheduled quarterly (open action).']),
  },
  {
    ref: 'A.8.8',
    title: 'Management of technical vulnerabilities',
    statement: 'Information about technical vulnerabilities of information systems in use shall be obtained, evaluated and appropriate measures taken.',
    domain: 'Operations',
    status: 'implemented',
    automated: true,
    implementation: li(['Dependabot and weekly <code>npm audit</code> in CI; high-severity findings block release.']),
  },
  {
    ref: 'A.5.34',
    title: 'Privacy and protection of personal information',
    statement: 'The organization shall identify and meet the requirements regarding the preservation of privacy and protection of PII.',
    domain: 'Privacy',
    status: 'implemented',
    automated: true,
    implementation: li(['Cookie and storage consent is mandatory before first use; only strictly necessary storage is used until the user agrees.', 'Consent is versioned and recorded (with hashed IP); users can change their choice at any time.', 'Public contact-form data is only visible to the CEO and administrators.']),
  },
  {
    ref: 'A.8.12',
    title: 'Data leakage prevention',
    statement: 'Data leakage prevention measures shall be applied to systems, networks and any other devices that process, store or transmit sensitive information.',
    domain: 'Data Protection',
    status: 'implemented',
    automated: true,
    implementation: li(['Uploaded files are served only to authenticated members of the owning organisation, with <code>nosniff</code> and forced download for non-image types.', 'API responses are sent with <code>Cache-Control: no-store</code>.']),
  },
  {
    ref: 'A.8.32',
    title: 'Change management',
    statement: 'Changes to information processing facilities and information systems shall be subject to change management procedures.',
    domain: 'Operations',
    status: 'in_progress',
    automated: false,
    implementation: li(['Pull-request review and CI gates for code; a formal change calendar for production releases is an open action.']),
  },
];

/** Idempotently inserts the baseline control set for an organisation (never overwrites edits). */
export async function ensureSecurityControls(organizationId: string, ownerId?: string): Promise<number> {
  let created = 0;
  for (const c of CONTROL_SEEDS) {
    const exists = await SecurityControl.findOne({ organizationId, ref: c.ref, isDeleted: { $in: [true, false] } } as any);
    if (exists) continue;
    await SecurityControl.create({
      organizationId,
      ...c,
      ownerId,
      lastReviewedAt: new Date(),
      nextReviewAt: new Date(Date.now() + 180 * 24 * 3600 * 1000),
    });
    created++;
  }
  if (created) logger.info({ created }, 'security controls baseline created');
  return created;
}
