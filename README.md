# Global SJX OS

The internal operating system and business management platform for Global SJX Limited — an ERP + CRM + project management + HR/LMS + document/knowledge management + BI dashboard + innovation platform + AI assistant, in one application.

Built with **TypeScript** end to end: **Node.js/Express/MongoDB (Mongoose)** on the backend, **React/Vite** on the frontend, styled in the same visual language as the Global SJX marketing site (dark/light mode, magenta `#C22FD4` + gold `#F0A93B` accents, Fraunces + Inter typefaces).

---

## What's here

```
gsjx-os/
├── backend/     TypeScript + Express + MongoDB API
├── frontend/    TypeScript + React + Vite dashboard app
├── website/     index.html — the public marketing site (contact form → Support Desk, cookie consent)
├── docs/        SECURE_DEVELOPMENT.md (policy) and ENVIRONMENTS.md
└── docker-compose*.yml, .github/   dev + production-like stacks, CI pipeline, Dependabot
```

## Latest additions

### Academy Beta
The Academy carries a **Beta** badge in the sidebar, page title and public course pages, plus a banner with a *Share feedback* form. Feedback arrives as a Support Desk ticket (category `academy_beta`) and notifies the CEO and administrators.

### Cookie consent (must be answered)
A blocking consent dialog appears in the app, on public Insights pages and on the marketing website until the visitor chooses **Accept all**, **Necessary only**, or **Customise** (preferences / analytics / marketing). Until then nothing beyond strictly necessary storage is written (the theme choice is only saved if *Preferences* is accepted). Decisions are versioned (`2026-10-01`), re-requested when the version changes, reopenable from **Settings → Privacy**, the login page, public pages and the website footer, and recorded server-side (`POST /api/consent`, IP stored only as a hash). CEO/COO/admin can see totals under *Information Security → Privacy & consent*.

### Information Security module (ISO/IEC 27001:2022)
**Information Security** in the sidebar (internal staff only):
- **Controls register** seeded with A.8.25 secure development, A.8.26 application security requirements, A.8.27 secure engineering principles, A.8.28 secure coding, A.8.29 security testing, A.8.30 outsourced development, A.8.31 environment separation, A.8.33 test information — each with the exact control statement, how it is implemented (and whether it is *enforced in code* or by procedure), owner, evidence links, review history and next-review date — plus A.5.15, A.8.5, A.5.17, A.8.15, A.8.24, A.8.13, A.8.8, A.5.34, A.8.12, A.8.32.
- **Security requirements**: draft → submit → approve/reject (CEO/COO/admin; the requester cannot approve their own) → verify with evidence.
- **Outsourced development** register with contract/NDA/right-to-audit/escrow/testing-evidence checks, risk rating and review dates.
- **Environments** panel showing live separation and hardening checks.
- **Audit log** viewer (filterable, paginated) and **policy acknowledgement** tracking.
The written policy is in `docs/SECURE_DEVELOPMENT.md` and seeded into the Knowledge Base.

### Additional security controls (all enforced in code)
Strict CSP / HSTS / no-referrer headers · request IDs · `no-store` on API responses · CORS allow-list (multiple origins) · NoSQL-operator and prototype-pollution stripping · server-side HTML sanitisation of all stored markup + DOMPurify on render · **mass-assignment protection** (fixed a real hole: generic create/update routes accepted `organizationId`/flags, and HR could grant `super_admin` — role escalation now restricted to CEO/admin and never to oneself) · **self-registration disabled by default and can no longer choose a role** · 12-character password policy · account lockout (5 failures → 15 min) · **session revocation** (token versioning; "sign out other devices"; password change signs out everywhere) · upload allow-list (extension + MIME, no SVG, UUID names, `nosniff`, forced download for non-images) · production refuses to start with weak secrets/dev database · seed script refused in production · generic error messages in production · dependency audit clean (`nodemailer` upgraded to 10.x, `uuid`/`node-cron` upgraded) · CI with type-check, tests, `npm audit`, secret scan, Dependabot.

### Support Desk, Knowledge Base, certifications, Hub
- Website **Contact us** → `POST /api/tickets/public/contact` (rate-limited, honeypot, no account) → Support Desk ticket + in-app and email alert to CEO/admins + confirmation to the sender. **Only the CEO and administrators can reply, change status/priority, assign or delete**; everyone else is read-only (internal notes are hidden from non-managers).
- **Knowledge Base:** multiple categories per article, summary, tags, filter by category/mine/on-website, threaded comments and replies, @mentions, rich text. **CEO/admin "Push to website"** publishes approved articles to public `/insights` pages.
- **Rich text everywhere:** one editor (bold/italic/underline, headings, lists, quotes, code, links, uploaded or linked images) now powers article bodies, announcements, tickets, certification updates, tasks, projects, ideas, meetings, course/assignment/quiz descriptions and all generic-module descriptions; it renders as real lists, links and images.
- **Certification updates:** HR/COO/CEO/admin add dated updates (exam postponed/scheduled, meeting, new training attached, renewal, general, with links); the employee is notified in-app and by email and sees them on the Hub.
- **Hub:** greeting + live stats, filterable company feed with reactions and comments, recognition wall, my next 14 days, my certifications and updates, learning progress and suggestions, latest knowledge, goals, events, new faces, birthdays.

### Deploying
`docker compose up --build` (development, isolated network/volume). `docker-compose.prod.yml` is a production-like stack (authenticated, unexposed Mongo; API refuses weak config). See `docs/ENVIRONMENTS.md`. For the marketing site, set `<meta name="gsjx-api">` in `website/index.html` to your API URL and add the site's origin to `CLIENT_ORIGIN`.

### Tests
`cd backend && npm test` — 13 tests (sanitiser, password policy, HTML sanitiser, markup middleware, security headers, auth gates, CORS, self-registration). They run without a database. **The database-backed flows (login, tickets, KB, certification updates) were type-checked and built but not exercised against a live MongoDB in the build environment** — run the app and walk through them once after seeding.

## Quick start

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env        # edit MONGO_URI if not using local Mongo on default port
ALLOW_SEED=true npm run seed # (development only) wipes and repopulates the database with realistic sample data
npm run dev                  # starts the API on http://localhost:5000
```

The seed script prints login credentials for every seeded role, e.g.:

```
CEO login: admin@globalsjxltd.com / ChangeMe123!
```

(Change `SEED_ADMIN_PASSWORD` in `.env` before seeding if you want a different password.) Every other seeded employee (COO, HR, Sales, PM, Engineer, Finance — see `src/seed/seed.ts` for the full list and emails) shares the same seeded password.

Leave `SMTP_HOST` blank to have outgoing email (certification/contract expiry notices) log to the console instead of sending — nothing breaks, it just won't deliver until you configure real SMTP credentials.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env         # points at http://localhost:5000/api by default
npm run dev                  # starts the app on http://localhost:5173
```

Open `http://localhost:5173`, sign in with a seeded login, and you're in. Press **Ctrl/Cmd+K** anywhere to open the command palette.

### Requirements

- Node.js 20.19+ or 22 (the HTML sanitiser uses ESM-only dependencies)
- A MongoDB instance (local `mongod`, Docker, or a free MongoDB Atlas cluster — just point `MONGO_URI` at it)

---

## Architecture notes

**Multi-tenant-ready from day one.** Every business record carries an `organizationId`. Today there's exactly one organization ("Global SJX Limited," seeded as `isInternal: true`), but every query in every controller is scoped by the requester's organization. That's the guard rail that lets this become the "external companies can create their own organization" SaaS product described in the brief, without a schema rewrite.

**Soft delete everywhere, enforced automatically.** Every business model (21 of the 24+) uses a shared `softDeletePlugin` that adds `isDeleted`/`deletedAt`/`deletedById` and **Mongoose query middleware** that transparently excludes deleted records from every `find`/`findOne`/`findOneAndUpdate`/`countDocuments` call — including ones written before the plugin existed, or ones a future contributor forgets to filter manually. This is what closes the "hard delete leaves dangling references" gap: a referenced document is never actually gone, it's just flagged, so `populate()` never breaks. `restore` endpoints exist on every module. Projects and Clients additionally **block** deletion (with a clear error) if they have open work under them, unless `?force=true` is passed.

**Role-based access control, enforced on both ends.** JWT-based auth; roles are `super_admin, ceo, coo, finance, hr, sales, project_manager, engineer, employee` (internal) plus `client, vendor, training_customer` (external portal roles). On the backend, `super_admin` bypasses role checks and write-sensitive routes are role-gated. On the frontend, the sidebar and command palette hide modules the signed-in role can't use, `ProtectedRoute` redirects away from a restricted URL even if typed directly, and per-module `canCreate`/`canEdit`/`canDelete` props hide or disable the relevant buttons — see `frontend/src/lib/permissions.ts`, which mirrors the backend's decisions in one place so the two can't silently drift apart.

**Two-factor authentication (TOTP).** Real, not a stub: `POST /auth/mfa/setup` generates a secret and QR code (`otplib` + `qrcode`), `POST /auth/mfa/verify` confirms it and turns MFA on, and from then on `POST /auth/login` returns `{ mfaRequired: true, challengeToken }` instead of a session token — the real token is only issued by `POST /auth/mfa/challenge` after a valid 6-digit code. Disabling MFA requires a current code too, so a stolen session token alone can't turn it off. Frontend: `Login.tsx` handles the two-step flow, `Settings.tsx` has the enable/disable UI with the QR code.

**Real file storage.** `backend/src/services/storage.service.ts` defines a `StorageAdapter` interface with a working local-disk implementation. Files are served through an **authenticated** Express route (`/api/uploads/:orgId/:filename`, org-scoped, path-traversal guarded) rather than `express.static`, so access control is enforced per-request. Swapping in S3/GCS later means implementing the same three-method interface.

**Email.** `backend/src/services/email.service.ts` wraps `nodemailer`. If `SMTP_HOST` isn't set, it logs the email instead of throwing, so automation jobs can call `sendMail()` unconditionally. Wired into the certification-expiry and contract-expiry automation checks alongside the existing in-app notifications.

**Structured logging.** `pino`/`pino-http` throughout (pretty-printed in dev, JSON in production) — replaced every `console.log`/`console.error` and `morgan`.

**Audit trail.** The generic CRUD factory and the bespoke controllers both write to an `ActivityLog` collection on create/update/delete.

**SJX AI is intentionally rule-based, not a wrapper around a hosted LLM.** `backend/src/controllers/ai.controller.ts` detects intent from the message text and answers by querying MongoDB directly — "what's overdue," "certifications expiring," "client summary," "project status report," etc. are all real data, not generated text. The natural next step is wiring a real LLM in front of this as a router/formatter, with these handlers exposed to it as verified "tools."

**Automation engine.** `backend/src/jobs/automationJobs.ts` implements the four automation examples from the brief (certification expiry → task + notification + email, contract expiry → notify account owner + email, overdue milestone → risk + notification, stale client → flag for attention) as both a daily cron job (`node-cron`, 02:00) and a manually-triggerable endpoint (`POST /api/automation/run`, `coo`/`ceo`/`super_admin` only).

**Generic CRUD factory.** Several simpler modules (Vendors, Sponsors, Skills, Compliance, Risks, Reports, Tickets, Campaigns/Marketing, Goals, Certifications, Documents) share one tenant-scoped CRUD controller/router factory (`backend/src/factories/`) and one configurable frontend list+form component (`frontend/src/components/ui/ResourcePage.tsx`) — which now also handles file uploads (a `file`-type field), server-side search, and pagination — rather than bespoke code per module.

**Shell UX.** Command palette (Ctrl/Cmd+K — searches live records and jumps to any module you have permission for), quick-create (`?new=1` convention: the picker navigates to the right module and a shared `useQuickCreate` hook tells that page to pop its own create modal open), breadcrumbs, a help/shortcuts panel, an honest organization-switcher placeholder (explains it's single-tenant today rather than faking a dropdown), and a mobile bottom tab bar (Home / My Work / quick-create / AI / Profile, hidden ≥980px).

**Global SJX Hub.** A lightweight company-intranet landing page — pinned announcements (with a real `Announcement` model and HR/COO/CEO-gated posting), new joiners in the last 30 days, company-level goal progress, trending Idea Room submissions, and upcoming birthdays (opt-in `dateOfBirth` field — nobody's birthday is inferred or shown unless they've set it).

**Task assignment, for real.** The task creation form has an actual "Assign to" picker (any employee, not just yourself) and an optional project picker (leave it blank for a personal task). The assignee gets notified — this was already true on the backend from the first RBAC pass, it just wasn't exposed in the UI before.

**Tab-level creation everywhere it matters.** Every tab on a Project's detail page (Tasks, Milestones, Risks, Meetings, Documents) has a real "New" action scoped to that project — no more dead-end read-only tabs. Same for a Client's Contacts, Contracts (permission-gated), and Projects tabs, including a "New project" link that deep-links into the Projects page with the client pre-filled and the create modal already open.

**Meetings with real attendees, no fake video integration.** Rather than build a Zoom/Google/Microsoft OAuth integration that couldn't honestly be tested against live credentials in this environment, meetings support a plain `meetingLink` field (paste any Zoom/Meet/Teams URL) plus genuine internal attendee selection (multi-select from the employee directory) and external attendees (name + email rows). Internal invitees get an in-app notification; external attendees — who have no account — get emailed the invite via the existing email service.

**Academy & Training authoring.** CEO/COO/HR can create Academy offerings and internal courses with currency, price, delivery mode (virtual/physical/hybrid) and an optional capacity — enforced server-side (`writeRoles: ['hr','coo','ceo']` on the courses CRUD route, not just a hidden button). Academy courses can be shared via a public link (`/academy/public/:id`) that needs no login — a genuinely separate, unauthenticated route that only exposes courses explicitly marked public and published, showing seats-remaining computed from real enrollment counts.

**RBAC, enforced on both ends, extended this pass.** Beyond the original employee/vendor/etc. gating: Projects (create/update/delete/restore — `project_manager`/`coo`/`ceo`), Clients (`sales`/`coo`/`ceo`), Contracts specifically (`sales`/`coo`/`ceo`/`finance` — narrower than general client editing since contracts carry legal/financial weight), and Opportunities (`sales`/`coo`/`ceo`) are now all backend-enforced with `requireRole`, matching the frontend's button-hiding via the shared `permissions.ts` module. A plain `employee` role can no longer create, edit, or delete a client, project, or contract by calling the API directly — the UI was never the only line of defense.

**Meeting invites: roles, departments, and reusable groups — not just individual picks.** A new `Group` model (name, description, members) has full CRUD via a dedicated Groups page in the sidebar. Scheduling a meeting now offers four ways to invite people internally — pick individuals, invite everyone with a given role (e.g. every engineer), everyone in a department, or a saved group — all resolved server-side against the live employee directory and de-duplicated. Every internal invitee gets both an in-app notification and an email (previously only external attendees were emailed); the meeting record keeps a transparency trail of how each person was invited.

**Multi-file document upload.** `POST /api/uploads/multi` accepts up to 20 files in one request. A reusable `MultiFileUploadModal` (per-file editable titles, one shared category) is wired into both the main Documents module and every Project's Documents tab, so uploading a batch of deliverables is one action instead of one-file-at-a-time.

**Academy & Training became a real, if intentionally scoped, LMS.** Courses now carry embedded content modules, assignments, an announcement-style updates feed, and course groups for group projects — with a dedicated `AssignmentSubmission` collection for real per-student submissions and grading (text and/or file, one resubmission allowed until graded, then locked). A full `CourseDetail` page (`/training/:id` and `/academy/:id` — same page, same underlying `Course` model) ties it together: students submit assignments and see their grades, instructors post updates and grade submissions, and course creation/editing rights extend to whoever created the course, not just HR/COO/CEO. Academy offerings can be shared via a genuinely public, unauthenticated landing page (`/academy/public/:id`) showing real seats-remaining computed from live enrollment counts.

**Idea Room and Knowledge Base got real detail pages.** Every idea now opens into a full page with the complete business case, an AI-score breakdown, a comment thread, and the ability to attach links and files — images render as inline previews, everything else as a download link. The Idea Room already had a `links`/`attachments` schema and controller from earlier in the build; this pass confirmed it end-to-end and wired the click-through from both the Idea Room grid and the Global SJX Hub's trending-ideas widget. The Knowledge Base got the one piece it was missing: a full article reading view with inline editing (author or HR/COO/CEO/super_admin) and delete, rather than a list with no way to actually read an article.

---

## Module coverage

| Module | Backend | Frontend |
|---|---|---|
| Employee management | bespoke controller (`users.routes.ts`) | bespoke-config `ResourcePage`, role-gated |
| Tasks | bespoke (kanban, comments, activity, subtasks, soft delete) | bespoke (drag-and-drop kanban + paginated list + detail) |
| Projects | bespoke (health, milestones, delete-blocking) | bespoke (cards + tabbed detail) |
| Clients / CRM | bespoke (contacts, communications, contracts, delete-blocking) | bespoke (list + tabbed detail) |
| Sales pipeline | bespoke (stage transitions, automation trigger) | bespoke (drag-and-drop kanban) |
| Vendors / Sponsors | generic CRUD, role-gated writes | generic `ResourcePage` |
| Documents | generic CRUD | generic `ResourcePage` with real file upload |
| Certifications | generic CRUD + expiry automation + email | generic `ResourcePage` with employee picker |
| Training | generic CRUD + enroll | bespoke catalog + enroll |
| Skills / Goals | generic CRUD | generic `ResourcePage` |
| Marketing | generic CRUD (Campaign + Lead models), role-gated | generic `ResourcePage` |
| Meetings | bespoke (action items → tasks, internal + external attendees, notifications + email) | bespoke |
| Reports / Risks / Compliance | generic CRUD, leadership-gated writes | generic `ResourcePage` |
| Knowledge management | bespoke (Mongo text search, author/manager-gated edit) | bespoke (search UI + full article detail/edit page) |
| Idea Room | bespoke (voting, lifecycle, heuristic AI score, comments, links, attachments, soft delete) | bespoke (cards + full detail page with comments/links/image previews, surfaced on the Hub) |
| Groups | generic CRUD | generic `ResourcePage` with a real multi-select member picker |
| Course content (LMS) | bespoke (modules w/ progress tracking, assignments w/ multi-file + resources, quizzes w/ auto-grading, gradebook, discussion forum w/ visibility targeting, updates, course groups, manual enrollment mgmt) | bespoke `CourseDetail` page, 9 tabs |
| Support/service desk | generic CRUD | generic `ResourcePage` |
| Global SJX Academy | reuses Course model (`isPublicOnAcademy`, capacity, delivery mode), role-gated authoring, public share route | bespoke storefront + public unauthenticated landing page |
| AI assistant | bespoke, rule-based, real-data-grounded | bespoke chat UI |
| Workflow automation | cron + manual trigger + email | surfaced via notifications |
| Company dashboard | bespoke, role-aware aggregation | bespoke, charts + widgets |
| Global SJX Hub | bespoke (`Announcement` model + aggregation) | bespoke intranet page |
| MFA | bespoke (TOTP, challenge-token flow) | bespoke (login step + Settings card) |
| File storage | local-disk adapter behind an interface | upload field + protected-download helper |

---

**Academy/Training got a real Moodle-inspired LMS layer** — not the whole platform (that would be several more products' worth of scope), but the pieces that were concretely requested and realistically buildable in this pass:
- **Multi-file assignment submissions and instructor resource attachments** — assignments can now carry attached files (instructions, templates) and students can submit multiple files, not just one.
- **A real Quiz activity** — multiple-choice questions with per-question point values, auto-graded on submission. Correct answers are hidden from students until after they've attempted it; a manager sees everything.
- **A Gradebook** — a real student × assignment/quiz score matrix, computed server-side from actual submission and attempt records, not a mockup.
- **Manual student enrollment management** — instructors/admins can add or remove specific students from a course, not just wait for self-enrollment.
- **Progress tracking** — students can mark content modules complete; `Enrollment.progressPercent` and status (`in_progress`/`completed`) update automatically from real completion data.
- **Course discussion (a forum, in Moodle terms)** — a new `CoursePost` model with genuine visibility targeting (public, instructors-only, a specific person, or a specific course group) and one level of threaded replies, enforced server-side.

Explicitly **not** attempted, on the theory that saying so is better than quietly shipping something thin: Workshop-style peer assessment, a Blocks/plugin system, reusable cross-course question banks, weighted gradebook categories/scales, conditional activity completion rules, backup/restore, and a native mobile app.

**Mentions/tagging, built once and reused.** A shared `MentionTextarea` (type `@`, pick a colleague, inserts `@[Name](id)`) and `MentionText` renderer, backed by one backend `notifyMentions` helper — wired into Idea Room comments and Course discussion posts/replies, with real notifications sent to whoever's tagged.

**Real security hardening, not hand-waving.** Fixed a genuine ReDoS vulnerability — every search endpoint built MongoDB `$regex` filters directly from raw user input with no escaping, so a crafted search term could hang the database. Now escaped everywhere via one shared `escapeRegex` utility. Also added a tight rate limiter specifically on login/register/MFA-challenge (20 attempts / 15 minutes), separate from and in addition to the general API limiter.

**The "enrolled course" dashboard gap turned out to be a labeling bug, not a missing feature** — the backend was already returning real enrollments; they were just mislabeled "Recommended courses." Fixed and surfaced on both My Work and the main Dashboard.

## Bug fixes along the way

- `POST /api/enrollments` was crashing (`Path 'userId' is required.'`) because the generic CRUD factory never set `userId` from the requester. Replaced with a bespoke enrollments route: self-enrollment defaults to the requester, HR/COO/CEO can enroll someone else, capacity (`maxStudents`) is enforced, duplicate enrollment is blocked.
- The dashboard's "Pipeline by stage" chart was rendering blank on shorter viewports — a classic `recharts`-inside-`ResponsiveContainer` sizing bug when the parent has no explicit height. Fixed with an explicit-height wrapper and a proper empty state.
- Every modal in the app (not just one page) could render with its title bar scrolled above the visible viewport on shorter screens, because the shared `.overlay` CSS centered content vertically with no scroll fallback. Fixed once at the shared CSS class, which fixed it everywhere at once.

## What was explicitly requested but not attempted

A later request in this build asked for ~55 additional enterprise modules (Asset Management, License Management, ISO 27001/9001 Management, a visual drag-and-drop Automation Centre builder, Product/Solution Catalogue, full employee Onboarding/Offboarding wizards with cascading automation, Performance Reviews, a company-wide Calendar, a Template Library, a Contact Directory, and a native mobile app) on top of everything above. That is realistically several more products' worth of scope, each needing its own data models, APIs, and UI to be built honestly rather than stubbed. None of it is in this codebase — it was declined explicitly rather than partially faked, so this list should be treated as a real backlog, not a set of things quietly skipped.

A separate request asked for real Zoom/Google Meet/Microsoft Teams integration (OAuth credential storage, automatic meeting creation via each provider's API). That was also explicitly descoped, on the person's own instruction, in favor of a simpler and fully honest approach: a plain meeting-link field plus real internal/external attendee management and notifications. If real provider integration is wanted later, the natural next step is a `VideoProvider` adapter behind the same interface pattern used for file storage (`storage.service.ts`) — Zoom's Server-to-Server OAuth is the most tractable of the three to implement first.

## What would come next for real production hardening

- S3/GCS storage adapter (the interface is ready; only `LocalDiskStorageAdapter` is implemented)
- Rate limiting tuned per-route rather than one global limiter
- A real hosted-LLM layer in front of SJX AI for open-ended questions
- **More automated tests** — security/HTTP tests exist (see *Tests*), but there is no database-backed integration suite yet.
- CSV/PDF export on Reports; drag-and-drop reordering beyond kanban; bulk actions on list pages
- Infrastructure-as-code and a deployment pipeline (CI and Docker Compose are included)
- Billing/subscription logic for the "external orgs can sign up" SaaS future state
- A full accessibility audit (modal focus-trapping and command-palette keyboard nav are solid; form-level `aria-describedby` wiring is not comprehensive yet)

## Tech stack

**Backend:** Node.js, TypeScript, Express, MongoDB/Mongoose, JWT, bcryptjs, otplib, qrcode, nodemailer, pino, node-cron, multer, Zod, Helmet, express-rate-limit
**Frontend:** React 18, TypeScript, Vite, React Router, Framer Motion, Recharts, @dnd-kit, Lucide icons, Axios

---

## Legacy-app absorption (v2)

Everything the old app did now lives inside GLOBAL SJX OS, rebuilt with security first.

| Area | Where | Notes |
|---|---|---|
| Expenses | `/expenses`, `/expenses/new` | Many items per claim, grouped by category; multiple receipts/photos per item; "bought by" = employee or typed name; **company paid / paid personally / awaiting disbursement**; per-item approve/reject; VAT/WHT; duplicate and missing-receipt flags. Creating a claim e-mails everyone holding `expense_approvals` with employee details, account info and the disbursement choice. |
| Employees | `/employees` | Onboarding wizard asks **"create credentials?"**, then role, module grants/denies, account info, certifications. Profile shows trainings, certifications, sessions; credentials can be created, reset or revoked later. |
| Roles ↔ modules | `/access` | Roles tied to modules, per-person overrides, periodic access reviews with four-eyes. |
| Finance | `/invoices`, `/accounts`, `/taxes` | Atomic invoice numbers, approval, PDF, e-mail, payments with WHT credit, VAT/WHT records and returns, exchange and tax rates. |
| ISMS | `/assets`, `/incidents`, `/policies`, `/privacy`, `/audit` | Asset register with hash-chained history and secure disposal; incident register with the 72-hour breach clock; policies with acknowledgement; DSAR (30-day SLA) and ROPA; daily-sealed audit log. |
| **Reporting** | `/reports` | 36+ reports across Security, ISMS, Data Protection, People, Finance and Executive — run, export CSV/PDF, or schedule by e-mail. Each report needs its module. |
| **Reminders** | `/reminders`, dashboard widget | One engine, e-mailed every morning at 06:30 (Africa/Lagos), de-duplicated. |

### New environment variables
`DATA_ENCRYPTION_KEY` (**required** in staging/production — encrypts bank details; back it up separately, losing it makes those fields unreadable), `APP_URL`, `FOUR_EYES`, `INVOICE_TERMS_DAYS`, `EXPENSE_RECEIPT_REQUIRED_ABOVE`, `EXPENSE_EMAIL_FULL_ACCOUNT`, `SESSION_IDLE_MINUTES`, `PASSWORD_MAX_AGE_DAYS`, `DORMANT_ACCOUNT_DAYS`. See `backend/.env.example`.

### Run
```
cd backend && npm i && npm run build && npm test && npm run dev
cd frontend && npm i && npm run dev
```

## v3 — legacy migration, invoice design, recurring controls
* **Migration:** see `MIGRATION.md` (`npm run migrate:legacy -- inspect | dry-run | apply | verify | rollback`).
* **Invoices:** create/preview modals follow the legacy design; the invoice document (HTML + PDF) uses the Global SJX layout with A/B sections, split payment instructions and amount in words; e-mails use the legacy templates (`invoiceMail.service.ts`).
* **Controls** (`/controls`): 19 built-in recurring ISMS tasks — Wi-Fi, router and laptop passwords every 90 days, yearly risk assessment (risk manager → IT → CEO), access review, backup restore test, BCP/DR exercise, vulnerability review, policy review, internal audit, management review, awareness training, supplier review, RoPA/DPIA review, asset register review, physical walkthrough, domain/SSL expiry. Frequencies and owners are editable; overdue items escalate to the CEO and compliance managers; completions keep an evidence trail.

## v4 — tasks, approvals, evidence, meetings, e-mail intake, work reports

| Idea | Where | How it works |
|---|---|---|
| **All tasks / My tasks** | `/tasks` (tabs: All · My tasks · Awaiting my approval) | Every task you may see. Row menu on each task: View · Edit · Delete (only when your role/ownership allows), **Ask for update**, **Send task** (in-app, e-mail, or both — also to outside addresses) and **New meeting**. Confidential tasks are visible only to the people involved and can never be sent. |
| Visibility | server-side (`services/work.access.ts`) | Project members see the project's tasks; people outside see only tasks they own/created/approve/were sent. CEO sees everything; COO everything non-confidential. |
| Subtasks | task page → *Subtasks* | Same fields as tasks (severity, dates, evidence, approval). A task can't be submitted while subtasks are open. |
| Severity | tasks, milestones | Trivial · Minor · Major · Critical · Show stopper. Major and above, and anything on a milestone, require evidence by default. |
| Dates | tasks, subtasks, milestones, projects, goals, risks | Start and end date everywhere; a project may have **no end date** (ongoing). |
| Evidence & approval | task / milestone page | If a task has acceptance criteria or requires evidence it **cannot be completed directly**: the assignee attaches evidence + ticks criteria, **submits**, and the approver (named approver → creator → project manager → HR/CEO — never the assignee) **approves or sends back**. Approval issues a certificate PDF (with an optional ribbon). |
| Milestones | project → Milestones | Progress is computed from the tasks assigned to the milestone; a milestone with no tasks can't be completed. Updates feed, evidence, risks, meetings. |
| Risks | task / milestone / project → *Raise risk*, and `/risks` | *Risk*, *Blocker* or *Issue*; a blocking one marks the task/milestone **blocked** until closed. "Likelihood" is now **Severity** (existing data is migrated at start-up). |
| Why is it on hold? | click the *On hold / Paused* badge | Hold report: the reason, who/when, open risks & blockers, blocked milestones/tasks, status history and the project discussion. A reason is **required** to pause a project. |
| Meetings | `/meetings`, or *New meeting* on any task / subtask / milestone / project | Microsoft Teams, Zoom, Zoho Meeting, Google Meet, other link or in person, with ID / passcode / link. Title defaults from the task or milestone (editable). Invite people, roles, departments, groups, the project team and outsiders; attach files. **Every meeting sends an e-mail (with a calendar file) and an in-app notification.** |
| Recording reminders | meeting form checkbox | 5 minutes before: "don't forget to record". Then every morning (09:00 Lagos) until a recording is uploaded — capped at 30 — each e-mail has a **Stop these reminders** link. Uploaded recordings are also filed on the task/milestone. |
| Quarterly goals | `/goals` | Quarter picker; **only the owner can change progress / status**; marking a goal achieved needs evidence; the creator or leadership (never the owner) verifies it and a certificate is issued. |
| Quarter filter | tasks, projects, meetings, risks, goals, work reports, Reports centre | Calendar quarters (`2026-Q4`) or All time. |
| Row menus | every module | View · Edit · Delete, shown according to your permission on that row. |
| **Work reports** | `/work-reports` (module `work_reports`) | Tasks assigned per person, per project and per severity; **awaiting approval** with days waiting; milestone progress; open/blocking risks; meetings missing recordings; goals. Plus six engine reports under *Work & Delivery* in the Reports centre (CSV / PDF / scheduled). |
| **E-mail → tasks** | `/intake` (module `intake`) | Admin-defined rules: keywords (any/all), organisation names (must be mentioned, or sender is a known client contact), optional sender domains, default assignee/project/severity/due date, optional acknowledgement. Includes a **Test** tool, an inbox log with *Create task anyway*, and webhook setup. |
| Expenses | `/expenses/new` | A line total worked out from quantity × unit price is **read-only**; claim totals are display-only. |

### Setting up e-mail intake
1. Open **E-mail to Tasks → Connect your mailbox**, generate a secret (shown once) and copy the webhook address.
2. Point your mail provider's inbound routing (SendGrid Inbound Parse, Mailgun Routes, Postmark, or your own automation) at `POST /api/intake/email/<orgId>` with header `x-intake-secret: <secret>` (or `?secret=`).
3. Add a rule — e.g. keywords `task, training, audit`, organisation `Opex` — and use **Test** to check a sample message.
4. *Optional:* read a mailbox directly — `npm i imapflow mailparser` and set `INTAKE_IMAP_*` (see `.env.example`).

### After upgrading
* The server runs an idempotent migration at start-up (risk `likelihood`→`severity`, task dates/creator, milestone fields, goal quarter, meeting provider).
* **New modules `work_reports` and `intake`.** CEO/COO/super-admin get them automatically; project managers and HR get `work_reports` by default. If your organisation has customised role→module settings, grant them in **Access Control**.
* New env: `RECORDING_MAX_MB`, and optionally `INTAKE_IMAP_*` (documented in `backend/.env.example`).

## v5 — asset classification, offboarding & return of assets, threat intelligence, access control

Implements POL-5013 (Return of Asset), POL-5007 (Threat Intelligence) and POL-5016 (Access Control).

**New modules** (Access Control → grant per role/person; CEO, COO and administrators get all; HR gets `offboarding`; engineers get `threat_intel`):
`offboarding`, `asset_policy`, `threat_intel`, `threat_intel_manage`. Customised roles need these granted once.

### Asset classification & naming (Assets → "Classification & naming policy")
- Public / Internal / Confidential / Restricted are decided **automatically from the title and description** using editable keyword rules (highest rule wins), with a minimum per category.
- Nobody can pick a label *below* what the rules require; only an `asset_policy` holder can override, with a recorded reason. Source is stored (`auto` / `manual` / `override`).
- **Names that cannot be entered**: editable list (whole word / contains / regex) plus built-in checks for placeholders, e-mail addresses, passwords/keys/tokens, card numbers (Luhn) and optionally IP addresses. The form checks live; the API returns 422.
- "Preview effect on the register" shows which assets would be raised (labels are only ever raised, never lowered) and which names are unacceptable.
- API: `POST /api/assets/classify`, `GET|PUT /api/assets/policy`, `POST /api/assets/policy/rescan`.

### Offboarding & return of assets (`/offboarding`, leaver: `/my-offboarding`)
- HR/admin starts a case (or deleting/deactivating a user opens one automatically). A checklist is built from **everything assigned to the person**: assets, open tasks/subtasks, pending approvals, projects, goals, risks, plus policy items (keys/cards, papers, personal equipment, knowledge hand-over) and accounts.
- The leaver declares each item (condition, physical/digital, "data erased") → HR/IT **verifies** it, recording condition and, for devices, that the wipe was verified and how. Only then is it *reclaimed*; the asset is unassigned and its condition stored on the asset and in its hash-chained history.
- Work items are reassigned (single or bulk) with notifications. Exceptions (policy 2.6), employee purchase (2.3.1), write-off (opens a "lost device" incident), and four-eyes (you cannot clear your own case).
- Leaver signs the inventory (2.5). The case cannot be cleared with open items (CEO/admin may force with a note, recorded).
- Access is switched off automatically on the last working day (or immediately): account deactivated, sessions ended, tokens invalidated, module grants removed. The leaver gets reminders at 14/7/3/1/0 days; overdue items escalate daily. A PDF return record is kept (5 years).

### Threat intelligence (`/threat-intel`)
- Strategic / tactical / operational layers, severity, confidence, Admiralty credibility, **TLP** (RED is visible only to named people and can never be shared).
- **Vetted sources only** (reliability A–E, review date). Seeded list: MITRE ATT&CK, CISA KEV (auto-collect), NVD, OTX, SANS ISC, VirusTotal, Recorded Future, Anomali, IBM X-Force, internal.
- Indicators: type auto-detected, defang-aware (`hxxp`, `[.]`), bulk add, STIX 2.1 / CSV / text import, "is this a known threat?" check, expiry, allow-listing.
- Analysis → **exposure check against the asset register**, actions (risk assessment, control update, test input, hunt, awareness, patch) that can create a Task and a Risk, one-click Incident.
- **Hunt**: compares active indicators with sign-ins, audit log, e-mail intake log and the user directory.
- **Sharing**: only analysed intelligence; TLP gating; anonymisation (removes our name, e-mails, internal IPs, asset ids); STIX 2.1 export; every share logged.
- Feed fetching is SSRF-guarded (https only, public addresses only, redirects re-checked).

### Access control (POL-5016)
- De-registration on HR request is the offboarding flow above. New: a daily job reminds `access_control` holders when the last access review is older than 3 months (privileged) / 6 months (all users).

### Fixed along the way
- New assets no longer fail with 409 when the next number was already used by a seeded/imported asset.
- Notification types `offboarding` and `threat_intel` added.

## v6 — task workflow, shared comments, notification settings (Phase 4)

**Task statuses** (one place: `backend/src/config/taskStatus.ts`, mirrored in `frontend/src/lib/taskStatus.ts`):
open (default) · in progress (with a completion %) · on hold · delayed · to be reviewed · to be tested · complete · closed · cancelled · abandoned.
Old values are migrated automatically at start-up (todo/backlog → open, blocked → on hold, awaiting approval/review → to be reviewed, done → complete).

- **Every status needs a comment, even "open".** `POST /api/tasks` requires `statusComment`; every change goes through `POST /api/tasks/:id/status {status, comment, …}`. The comment is the next message in the task conversation. `PATCH` no longer accepts `status`.
- **In progress** carries a percentage (`POST /:id/progress`). Reaching 100% sends the task to review.
- **On hold** needs a reason. "Awaiting another person" / "awaiting the CEO" can create a task for that person from this task; when they complete it, this task resumes automatically (and its owner is told if it is dropped instead).
- **Delayed** is an escalation: needs a new date, tells the owner's manager, project manager and creator at once. A daily job also flags overdue work as delayed and escalates with age: 1 day = manager / project manager; 3 days = + department head and COO; 7 days = + CEO.
- **To be reviewed** routes to: the named approver, else the department head (set `headOfDepartments` on a user), else the owner's manager, else the project manager, then HR / CEO. The owner can never review their own work.
- **To be tested** can name a tester.
- **Cancelled / abandoned** need a real explanation (a sentence) or evidence. Owners can abandon their own task; only a task manager can cancel.
- **Closed**: only the project owner (project manager) can close, or the creator for a task with no project; CEO / administrator can step in. A task is completed by its reviewer first, then closed.
- **Multiple owners** (`ownerIds`, first = primary). Co-owners see it in My tasks, get reminders and can change status.
- **Notifications**: everyone in the project (team, project manager, milestone owner) hears when a task is created, changed or moves status.

**Comments on every module** (`/api/discussions/:type/:id`, React `<Discussion entityType entityId />`): threaded replies, reactions, edit (own comments, history kept), delete (own, or a manager; status comments can only be removed by leadership), @-tags, "tag for awareness" (adds them as followers), attachments, and a choice of who is notified (people you tag / everyone involved / nobody). Wired into tasks and clients now; supported types: task, project, milestone, client, contract, opportunity, vendor, campaign, lead, expense, invoice, sponsor, risk, goal, ticket, asset, incident, document, post.

**Notification settings** (Settings → Notifications; `/api/notification-prefs`): per category, in-app and e-mail; mute a single task. Urgent (high / critical) and security notices always arrive.

**Updated-by stamp**: tasks, projects, clients, opportunities, vendors, campaigns, leads, expenses, invoices, sponsors and documents now record who created / last changed them, when, and from which device and IP (`createdBy`, `updatedBy`, `updatedFrom`). Shown in the UI and exports.

**Also**: collapsible sidebar (button or Ctrl+B, remembered); compulsory client fields (name, e-mail, phone, office address, state, country) checked on screen and by the API, with an "incomplete profile" flag on older clients; clients and tasks have filters and CSV export; **My report** (`/my-report`) for your own tasks and projects by day, week, month, quarter or from any date.

Needs after upgrading: nothing to run (migrations are automatic). For department-head routing, set "headOfDepartments" on the right employees (PATCH /api/employees/:id).

## v7 — Clients and sales (Phase 5)

- **Project statuses**: initiation, planning, execution, monitoring, closure, active, inactive. Only the project owner (or CEO/admin) can move a project to closure or inactive; open tasks block closure unless forced.
- **New project from a client**: client page → "New project"; client is pre-filled.
- **Contracts**: on the client page. Signed copy up to 10 MB (PDF/Word/scan); a contract can only be marked "signed" once the signed file is attached.
- **New opportunity from a project**: project page → "Raise opportunity".
- **Pipeline**: Lead, Qualified, Discovery, Proposal, Negotiation, Documentation, Closed Won, Closed Lost. Every stage move needs a comment; Documentation needs documents; Closed Won needs signed documents unless leadership skips; Closed Lost needs a reason.
- **Contacts on opportunities** and **vendor contacts**.
- **Opportunity report** (Sales → Report): what we are doing now, what happened, how to convert open deals, how to improve (rule-based).
- **Every list**: filters, created-date range, Export CSV, Modified column; records show created/modified and who updated, when, and from which device.
- **Comments and documents** (threaded, reactions, edit/delete) on tasks, projects, milestones, clients, contracts, opportunities, vendors, sponsors, campaigns, documents.
- Migration: existing projects/opportunities get mapped to the new statuses on startup.

## v8 — Marketing, money and loose ends (Phase 6)

**Marketing** (Marketing page: Overview · Campaigns · Waiting for approval · Social accounts · Leads)
- **Goal-based campaigns**: traffic, hiring (employ staff), monetary value, leads, awareness, event, other. Each has a numeric target; results (reach, clicks, leads, hires, revenue, spend) feed a progress bar, return-on-spend and plain "how it is going" hints.
- **Post and pictures**: choose channels (Facebook, Instagram, LinkedIn, X, TikTok, YouTube, WhatsApp, website banner, e-mail, other), write the post, add several images and banners (PNG/JPEG/WebP, 10 MB each, up to 12), and see a live preview with per-channel limits.
- **Approval before anything is posted**: the author sends it for approval; the CEO, COO, the head of Marketing (see Department heads) or a named approver decides. Approving needs a comment **and evidence** (file or link). Nobody can approve their own campaign (CEO/admin can, and it is flagged). The approval is tied to a fingerprint of the exact content, pictures and channels; changing any of them resets it and cancels anything not yet posted.
- **Social media manager queue** (`/social-queue`, anyone can be a manager): approved posts wait here. The manager copies the text, posts, then marks it posted with a link or screenshot, or sends it back with a reason. Posting is re-checked against the approval at the moment of posting.
- **Social accounts**: each account has a manager. Facebook, Instagram and LinkedIn can also be connected so the app posts for them (**you must supply your own Meta / LinkedIn developer-app access token and page id**; stored encrypted, never shown again). Instagram/Facebook pictures are handed over as 30-minute signed links, so set `PUBLIC_API_URL` to the public address of the API. LinkedIn pictures are posted by hand.
- Filters, export, comments, documents, created/modified/who/where on everything.

**Money**
- After creating an invoice you land on a new expense page already linked to it (skip returns to the invoice). The invoice shows its linked expenses.
- **Receipt of payment** (bank slip, up to 10 MB) can be attached when recording a payment, or added later; payments without one are flagged.

**Loose ends from Phase 5**
- Comments, documents and audit stamps now also on expenses, invoices, leads, risks, goals, tickets, assets and incidents. Private records stay private (an expense thread is visible only to the claimant and expense approvers).
- **Department heads** screen (People → Employees → Department heads): HR/COO/CEO/admin set one or more heads per department.
- A non-owner who cannot close or deactivate a project now sees who the owner is and gets a **Request closure** button that posts to the owner.
- Export on risks, goals, tickets, incidents, expenses, assets and invoices. Seed data uses the new pipeline stages.

## v9 — ISMS Automation Hub (Phase 7)

Open **Security & Compliance → ISMS Automation Hub** (`/isms`). Needs the new `isms` module: CEO, COO and admin have it; give it to the ISMS manager and risk manager under Access Control.

**Registers.** 25 registers can be generated as Excel files with your own headings and document IDs (GSJX-ISMS/REG-xxxx). 8 are built from live app data (assets on the 11 company sheets, IT access rights, incidents, threats, controls/SoA, document & record log, suppliers, roles tracker). 17 are kept in the hub itself and edited there (context/SWOT/PESTLE, roles, risk assessment, opportunities, change database, communication calendar, training calendar, BYOD, authorities & contacts, legal register, NDPA gap assessment, metrics, audit programme, management-review actions, CARs, observations, OFIs).
- Calculated for you: risk exposure and classification (your matrix: 1-4 Minor, 5-9 Moderate, 10+ Major), residual risk, next assessment date, metric target met, BYOD checks PASS/FAIL, BYOD review date.
- Procedures enforced: a CAR needs root cause, corrective action, a verification note and a verifier who is not the owner before it closes; a change needs a named sign-off, cannot be approved by whoever requested it, and needs a post-implementation review; a BYOD device is approved only when every check passes and the agreement is signed, and removed only when the data wipe is confirmed; training is Done only with an attendance number; an audit is Reported only with a report link.
- **Import** your existing spreadsheets (Import button on each register): headings are matched by name, closed/ongoing/delayed statuses are carried over, and importing the same file twice adds nothing twice. The two-row risk sheet, SWOT and PESTLE are read specially.

**Automation rules** (11, times Africa/Lagos, each run is kept as proof; switching one off needs a reason): due-date reminders as one digest per owner, late items flipped to Overdue and escalated to CEO/COO after 14 days; recurring communications/training re-schedule; metrics measured from app data (MFA %, policy acknowledgement %, assets with owner, incidents closed on time, CARs closed on time, training completed, risks reviewed on time, BYOD compliance, supplier reviews current) and a missed target opens an OFI; annual four-quarter audit programme; management-review prompt every 6 months; high/critical incident opens a CAR; leavers' BYOD devices suspended; supplier annual-review list; onboarding checklist for new staff; weekly TLS/SPF/DMARC check of `ISMS_DOMAINS`; monthly evidence pack (zip of all registers + SHA-256 manifest).

**Policy coverage** tab: one line for every document in the ISO folder saying whether the app enforces, automates, records or cannot do it (manual).

New dependencies (free): `exceljs` (MIT), `archiver`. Free built-in checks: Node `tls` and `dns` for domains; `node-cron` scheduling; CISA KEV feed already in threat intelligence.

## v10 — Risk heat map, suggested risks, awareness quizzes, phishing simulation and leaderboard (Phase 8)

**Risk heat map and suggested risks** (ISMS Automation Hub → Registers → Risk Assessment)
- A 5×5 likelihood × impact heat map using the company bands (1–4 Minor, 5–9 Moderate, 10+ Major). Switch between "before treatment" and "residual"; click a cell to list its risks.
- A weekly rule (`risk_suggest`, Mondays 06:50) proposes scored risks from live data: incidents by type, High/Critical assets that no risk mentions, phishing results, weak quiz topics, overdue supplier reviews, failing personal devices and end-of-life assets still in use. The ISMS manager accepts (creates a register entry, source = auto) or dismisses. Nothing is added without a decision.

**Security Awareness** (`/awareness`, available to every internal role)
- Role-targeted pop-up question (default 2 a day, minimum 3 hours apart; `AWARENESS_POPUPS_PER_DAY`, `AWARENESS_POPUP_GAP_HOURS`). It never blocks the screen; "✕" snoozes for 4 hours. The server picks the question, shuffles the options per person and checks the answer, so the page never contains the answer and refreshing cannot farm points.
- A library of 41 questions (everyone, finance, HR, engineers, sales, project managers, leadership) that the ISMS team can edit, add to, target by role and switch off. Questions lean towards topics a person finds harder.
- 5-question quizzes, personal progress by topic, "report a suspicious email" (a real report opens a low-severity incident and alerts the incident handlers).
- Points: 5/10/15 by difficulty, streak bonus, 60 quiz points a day cap, plus phishing rewards (25 for reporting a simulation, 10 if reported after a click, 10 for not clicking).

**Leaderboard** (Dashboard widget and Awareness page)
- People ranked by points for the month or all time; departments and roles ranked by AVERAGE points with participation %, so a small team can beat a large one; "most improved" compared with last month. Anyone can hide their own name; points still count towards the company figures.

**Phishing simulation** (Awareness → Manage → Phishing simulations)
- Authorised exercises only: the campaign needs the name of the approving manager and a tick-box confirmation; every create, launch and end is audited. Six generic templates (no real brand names). No login page, form or credential capture exists anywhere: a click opens `/phish/<token>` which explains the red flags. The exercise closes by itself after 7 days (`phish_close`).
- Results by department, repeat clickers flagged for coaching (not blame). A click creates a refresher task for that person.

**Automation additions**: `risk_suggest`, `awareness_digest` (weekly summary to the ISMS team, monthly nudge to everyone if under half took part), `phish_close`. Metrics can now be measured automatically from `phish_resilience`, `phish_report_rate`, `awareness_quiz_accuracy` and `awareness_participation`.

New module `awareness` (always on for staff). New environment variables are optional: `AWARENESS_POPUPS_PER_DAY`, `AWARENESS_POPUP_GAP_HOURS`.

## v11 — Asset threats and risks, full Annex A statement, evidence vault, continuity and retention (Phase 9)

Apply after Phase 8. Needs no new packages.

**Asset → threats → risks → people.** Adding, editing, retiring or deleting an asset now runs the asset risk engine (`services/assetRisk.service.ts`, catalogue in `config/threatCatalogue.ts`, 36 threats with Annex A references):

- Which threats apply is worked out from the asset's category, description and tags (personal-data words add the NDPA/personal-data threats), its CIA ratings, classification, end-of-life state, backup schedule and any live threat intelligence that matches it.
- Each threat is scored impact × likelihood. At or above `ASSET_RISK_AUTO_MIN` (default 5) it is written to the **risk register** (source "auto", owned by the asset owner, with the expected controls and Annex A mapping in the notes) and to the **threat register** (origin "asset"). Lower scores stay as suggestions on the asset, with Add to register / Not applicable (reason required, remembered).
- Notified: asset owner and custodian, the head of the asset owner's department, the ISMS team, the DPO for personal-data threats, and CEO/COO (with email) for anything Major. The owner also gets a follow-up task (7 days for Major, 14 otherwise). Bulk runs send one digest per owner.
- A risk a person has edited is never overwritten; the engine flags it instead. Risks of retired, disposed or deleted assets are closed. Planned assets create nothing until they go live.
- Endpoints: `GET /api/asset-risk/:id`, `POST /api/asset-risk/:id/{evaluate,accept,dismiss}`, `POST /api/asset-risk/backfill`. Weekly rule `asset_risk_sweep`. The asset detail window has a "Threats & risks" panel; the asset page has "Evaluate all risks".

**Statement of Applicability.** Register `annex_a`: all 93 ISO/IEC 27001:2022 Annex A controls (37/8/14/34), seeded once and never overwritten (`POST /api/isms/annex-a/seed`, also by rule `soa_sync`). Starting status comes from the existing security control library. Excluding a control needs a justification; "Implemented" needs a description. **Record a control test** in the control's window (`POST /api/isms/records/annex_a/:id/test`): Pass sets Implemented and schedules the next test (3/6/12 months); Partial retests in 30 days; Fail opens a CAR (or adds to the open one; a repeat failure makes it Major), brings the retest forward to 14 days and notifies the ISMS team and owner.

**Evidence vault** (ISMS hub, "Evidence vault" tab; `/api/evidence`). Files, links or written notes tied to Annex A controls / clauses / register records; files are SHA-256 fingerprinted when added and re-checked weekly; locking freezes an item; a new version supersedes the old one, which is kept; expiry dates open refresh requests; auditor-style evidence requests can be assigned and are fulfilled by adding evidence. Rule `evidence_watch`.

**Retention, deletion, legal hold, certificates.** Registers `retention`, `legal_hold`, `deletion`. While a hold is Active, moving a deletion whose item/system matches the hold's keywords forward is refused, the deletion is marked Blocked, the attempt is logged on both records and the ISMS team is told. A deletion needs approval, then who/when/how, then verification by a different person, after which a destruction certificate PDF is available. A hold must be released by someone other than the person who placed it. *The hold check covers the deletion log only; it does not stop someone deleting data directly in another system.*

**Continuity.** Registers `bia`, `backup`, `restore_test`. A restore test is verified by a second person; a failure or a restore slower than the recovery time objective (taken from the BIA when not typed) opens a CAR, updates the backup (last result, retest in 14 days) and sends a critical notification. A passing test schedules the next one by the backup's cadence (Tier 1 defaults to quarterly). *Whether a backup actually ran is typed in; the app does not read your backup tool.*

**Also new:** registers `capacity` (breach/watch computed), `baseline` (configuration baselines), `log_review` (weekly, pre-filled from the app's audit trail) and `maintenance` (repeats itself). Rule `ops_cycle` (Mondays 06:55) creates the log review, repeats maintenance, flags capacity breaches and stale backups.

**Not in this release (Phase 10):** auditor and supplier portals, vendor integrations (Action1, Cloudflare, JumpCloud, Google/M365, cPanel, GitHub, Nextcloud), e-signature, public data-subject request form.

## v12 — Public data-subject request form and auditor access (Phase 10, part 1)

Apply after Phase 9. No new packages.

- **Public data request page** `/data-request` (no sign-in): the person picks what they want (access, correction, deletion, restriction, portability, objection, withdraw consent), gives name and e-mail, and gets a reference such as `DSR-2026-0001` by screen and e-mail. The request lands in the Data Protection module (source "website") with the 30-day clock running, assigned to the first user with the data_protection module, who is notified. Requester can check status with reference + e-mail (nothing else is revealed). Protections: 6 submissions per hour per address, hidden honeypot field, input validated. *Identity is not verified automatically — staff must do that before disclosing or deleting anything. The 30-day period is the usual convention; confirm the period that applies to you with your data-protection officer.*
- **Auditor access** (ISMS hub → "Auditor access"; `/api/auditor-access`): create a link for a named auditor, choose which registers (and whether evidence) they may read, 1–60 days. Only a hash of the link is stored, and the link is shown once. The auditor sees `/auditor/<token>`: registers, the Statement of Applicability and the evidence vault (files downloadable), read-only. Every page they open is logged against the link, the ISMS team is told at first use, and revoking works immediately. *Registers may contain staff names; share only what the audit needs.*

Still to come (needs your input or credentials): supplier portal, vendor integrations, e-signature.

## v13 — Visitor management (Phase 10, part 2)

Three new modules: `visitors` (reception), `visitors_admin` (security and analytics), `my_visitors` (every employee, in the base set). Grant the first two under Access Control.

**Walk-in.** Reception registers the visitor and picks the host. The host gets an in-app and e-mail request and accepts or declines (a decline needs a reason; only the host can answer). The visitor is e-mailed the outcome. Reception checks them in, which assigns a badge number (V-001… per day), prints a PDF pass with a QR code and tells the host they have arrived. Check-out closes it.

**Advance booking.** Public page `/book-visit`: choose a person, a day (the calendar shows free slots per day), a time, then details. The slot is reserved at once, the visitor and host are e-mailed, and the visitor gets a pass page `/visit/:code` with a QR code and a cancel button. Only employees who switch on "Let visitors book time with me" under My visitors appear; the public sees name and department only.

**No double-booking.** Each reservation takes a database lock keyed on (host, start time) behind a unique index. Two people booking the same slot at the same moment: one succeeds, the other gets "no longer available". Slots also respect working hours, meeting length and gap, minimum notice, how far ahead, maximum per day, days away, and any overlapping visit. Cancelling, declining or a no-show frees the slot.

**Watchlist.** Security admins add flag or block entries. A match on e-mail or phone applies the level; a match on name alone only ever raises a flag. Reception sees "security alert" without the reason. A flag needs a note at check-in; a block can only be overridden by a security admin with a written reason. A blocked person booking online is turned away with a neutral message and security is notified.

**Emergency evacuation.** The On site tab lists every checked-in visitor with phone, e-mail and host. "Start evacuation" (drill option) freezes the list, alerts management and security, and lets reception tick people off as safe. Ending it with anyone unaccounted for alerts security. CSV and print are included.

**Analytics.** Visits per week, hour and weekday, busiest times, top hosts, average visit length, no-show rate, repeat visitors, online bookings, watchlist hits.

**Automation.** `visitor_morning` (07:35): reminders to visitors and a day list to hosts and reception. `visitor_evening` (19:30): no-shows, closing requests the host never answered, warning about visitors still checked in, and anonymising visits older than `VISITOR_RETENTION_DAYS`.

Not covered: staff and contractors are not tracked, so the evacuation list is visitors only. Hosts' leave and calendars are not read, so people must mark days away themselves. ID checking is by eye (only the last 4 characters are stored). Name/e-mail/phone matching on the watchlist is basic.
