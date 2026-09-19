# Re-entry regression verification — 2026-09-19

The deployed PostgreSQL database still had `attendance_unique_day` and only the first two migration ledger entries. The UI and service allowed repeated shifts, but PostgreSQL rejected the second shift with SQLSTATE `23505`. File-backed demo tests did not exercise this constraint.

Applied the existing `1789270000002_multiple_daily_shifts` migration after reproducing the failure against a disposable PostgreSQL 17 database. Production attendance count and the digest of every attendance payload were unchanged across the migration; `attendance_unique_day` was removed and `one_open_attendance` remained. No test attendance was inserted in production.

Prevention: `vercel.json` now uses `npm run vercel-build`, which first runs the read-only `check:schema` command. Pending migrations or incompatible attendance constraints block publication. Migrations remain an explicit release step.

Verified:

- Old PostgreSQL schema reproduces the exact `23505` error and rolls back the failed record, audit and request key.
- Deployment check fails before migration and passes afterward.
- Migration preserves existing attendance, audits and request history.
- Three same-day shifts; concurrent identical requests create one shift; concurrent distinct requests allow only one open shift.
- Replaying an old checkout cannot close a later shift.
- The database itself rejects a second open record.
- Overnight checkout stays attached to its original work date; re-entry belongs to the new day.
- Rolling back to the daily uniqueness constraint refuses duplicate-day data without deleting it.
- Browser regression passes against both the file demo and real local PostgreSQL: three cycles, reloads, double clicks, failure before sending, response loss after saving, both retry actions, owner correction, and 360/390/1440px layouts.
- Existing HTTP API suite passes against PostgreSQL: authorization, filtering, CSRF, idempotency, attendance correction, payroll, and deactivation.
- All 28 unit/domain tests, lint, typecheck, and the schema-gated production build pass.

Production verification was limited to schema readiness and unchanged attendance data. Destructive regression tests ran only on disposable local databases.
