# Moving the old Global-SJX database into GLOBAL SJX OS

**Best approach: a scripted, repeatable, read-only copy — rehearsed on a staging copy first, never a live "move".**
Your old data stays untouched, you can run the migration as often as you like, and you can undo a run.

## Why not just copy the collections across?
The two systems store things differently (e.g. old invoices keep `service1`/`service2`/`roles` blocks; the new system has line items,
payments, encrypted bank numbers and a tax ledger). A raw copy would break reports and leak plaintext account numbers/passwords.
The script *translates* every record, validates it with the new rules, and keeps a lossless encrypted archive of the original.

## What it does with each collection
| Old collection | Goes to | Notes |
|---|---|---|
| users, employees | Employees (User) | **Passwords are never copied.** Accounts are created with login switched off; give people access from *Employees → Create credentials*. Roles are mapped (`superadmin→super_admin`, `admin→coo`, `backoffice/frontOffice→finance`, others→employee — edit `ROLE_MAP` at the top of the script). Salary is kept encrypted in the archive. |
| clients | Clients | e-mail/phone arrays become contacts; `address` kept. |
| accounts | Bank accounts | Numbers encrypted (AES-256-GCM); active ones stay active. |
| invoices | Invoices | `service1/service2` → sections A/B, `roles`/`otherInvoiceServices` → lines, status → draft/approved/paid…, payment recorded when `amountPaid`>0, `GDP`→GBP, totals re-computed and **compared with the old totals**. |
| taxes, whts | Tax ledger | VAT output, WHT credit (invoices) and WHT withheld (expenses). |
| expenses | Expense claims | One claim per old expense, categories mapped, base64 receipts saved as real files (type-checked), WHT/VAT preserved. |
| rates, vats, services | Exchange rates, tax rates, service catalogue | Newest rate becomes active. |
| assets | Assets | With a tamper-evident first event. |
| everything else (auditlogs, taxreturns, assetevents, companies…) | Encrypted archive | Nothing is lost. sessions / joblocks / notifications are skipped (noise). |

## Step by step
1. **Back up both databases** — `mongodump --uri "<old>" --out backup-old` and the same for the new one. Keep them.
2. **Create a read-only user** on the old DB and put its URI in `backend/.env` as `OLD_MONGO_URI`. (`MONGO_URI` must be the *new* DB — the script refuses to run if they match.)
3. **Rehearse on staging**, not production: restore the new DB's dump into a staging DB and point `MONGO_URI` at it.
4. `npm run migrate:selftest` — proves the script works on throw-away data (optional but reassuring).
5. `npm run migrate:legacy -- inspect` — prints every collection's real field names. If something is named differently from what the script expects, it shows up here.
6. `npm run migrate:legacy -- dry-run --create-missing-clients` — validates **everything**, writes **nothing**, prints errors/warnings and saves a JSON report in `backend/migration-reports/`. Fix or accept each warning.
7. `npm run migrate:legacy -- apply --confirm-backup --create-missing-clients` — writes. Safe to re-run: records already migrated are skipped. Note the **batch id** it prints.
8. `npm run migrate:legacy -- verify` — reconciles counts per collection and **money totals per currency** (old vs new). The difference should be 0.
9. Check a few invoices by eye (open one, *View invoice*, compare with the old PDF), then re-issue logins from *Employees*.
10. **Cut over:** pick a quiet moment, make the old app read-only (or stop it), run `apply` once more to catch last-minute changes, `verify`, then switch users to the new app. Keep the old database read-only for at least 90 days.
11. Only then repeat steps 7–8 against **production** (`APP_ENV=production` needs `--i-know-this-is-production`).

**Undo:** `npm run migrate:legacy -- rollback --batch <id>` removes exactly what that run created (records you have edited since are kept unless you add `--force`).

## After migrating
* Rotate any secret that lived in the old app (SMTP, JWT, DB passwords) — the old plaintext employee passwords should be considered exposed.
* Delete `migration-reports/` when finished (it lists record ids).
* Legacy invoice numbers (e.g. `INV12345`) are kept as-is; new invoices continue as `INV-2026-0001`.
