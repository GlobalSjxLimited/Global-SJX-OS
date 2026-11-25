# Secure Development Policy — Global SJX Limited

Applies to all software and systems developed in-house or by suppliers, and to applications we acquire.
Implements ISO/IEC 27001:2022 Annex A controls **A.8.25 – A.8.31** and **A.8.33**. The live register (owners, status, evidence, reviews) is the **Information Security** page in GLOBAL SJX OS.

## 1. Rules for secure development (A.8.25)
1. Every change is made on a branch and merged by pull request with at least one reviewer who did not write it.
2. CI must pass before merge: strict type-check, build, automated tests, dependency audit (`npm audit --audit-level=high`), secret scan.
3. No secrets, customer data or production credentials in source control, tickets or chat.
4. Security-relevant changes (authentication, authorisation, file handling, cryptography) need a second reviewer from the security owner list.
5. Releases are built from tagged commits by CI only; rollbacks are documented.

## 2. Security requirements for applications (A.8.26)
- Before building or buying an application, requirements are recorded in **Information Security → Security requirements**, submitted, and **approved by the CEO, COO or an administrator** (never by the requester).
- Approved requirements are **verified** with evidence (test result, report, PR) before go-live.
- For acquired software, supplier due diligence is recorded in the Outsourced Development register.

## 3. Secure system engineering principles (A.8.27)
Defence in depth · least privilege · secure by default and fail closed · tenant isolation (`organizationId` on every record and query) · minimise attack surface · complete mediation (server-side checks on every request) · auditability (security events logged) · separation of duties (requesters cannot approve their own requirements).

## 4. Secure coding standard (A.8.28)
| Id | Rule | Where enforced |
|----|------|----------------|
| SC-01 | Validate all external input with schemas | zod in controllers |
| SC-02 | Strip `$`/`.` keys and prototype-pollution keys from requests | `sanitizeInput` middleware |
| SC-03 | Prevent mass assignment (`organizationId`, roles, flags) | `stripProtected()` in CRUD factory and routes |
| SC-04 | Escape user input in regular expressions; no string-built queries | `escapeRegex` |
| SC-05 | Hash passwords (bcrypt 12), enforce 12+ char policy, lock accounts after repeated failures | auth controller, `passwordProblems` |
| SC-06 | Sanitise rich text on the server (store) and in the browser (render) | `cleanHtml`, `sanitizeMarkup`, DOMPurify |
| SC-07 | Configuration from environment; validate at start-up | `config/env.ts` |
| SC-08 | No stack traces or internals in production errors | `errorHandler` |
| SC-09 | Uploads: size limit, extension + MIME allow-list, no SVG, UUID filenames, `nosniff` | `uploads.routes.ts` |
| SC-10 | Authorisation checked on the server for every write | `requireRole`, ownership checks |

## 5. Security testing (A.8.29)
- **Every pull request:** unit + HTTP tests (`npm test`), type-check, dependency audit, secret scan.
- **Weekly:** scheduled dependency audit; Dependabot pull requests.
- **Before release:** authentication/authorisation regression checklist; review of all new endpoints for role guards and tenant scoping.
- **Annually:** independent penetration test. Findings are logged as risks and tracked to closure.

## 6. Outsourced development (A.8.30)
Each supplier is registered with scope, contract reference, security clauses, right to audit, NDA, code ownership/escrow and security-testing evidence. An owner reviews the supplier at least every six months. Supplier code passes the same CI gates, and access to our repositories and environments is least-privilege, time-boxed and revoked at contract end.

## 7. Environment separation (A.8.31)
Development, test, staging and production use separate databases, secrets, origins and infrastructure (`docs/ENVIRONMENTS.md`). The API refuses to start in staging/production with default or weak secrets, localhost origins, or a database name that suggests another environment. The destructive seed script is blocked in production and requires `ALLOW_SEED=true` elsewhere.

## 8. Test information (A.8.33)
- Non-production environments contain **synthetic data only** (the seed script uses fictional people and reserved domains).
- Production data is never copied to non-production. If an extract is unavoidable it must be approved by the CEO/COO, masked, held only on an access-restricted host, and deleted after use; the approval is recorded.
- Test databases are ephemeral and are not backed up.

## 9. Review
This policy is reviewed every 12 months or after a significant incident, by the CEO and security owner. Staff acknowledge it in **Information Security → Overview**.
