# Backend operations

The API uses `pg` directly with PostgreSQL; Supabase is used only as a PostgreSQL host. Authentication is independent: salted scrypt password hashes and opaque random server sessions whose tokens are hashed in the database. Session cookies are HttpOnly, SameSite=Lax and Secure in production. Mutations require the configured origin and JSON. Employee responses are filtered by authenticated employee ID and omit payroll entirely.

## Initial production owner

Run migrations separately before serving traffic, then create the one owner account. Do not use development sample seed for production.

```sh
npm run db:up
# Set DATABASE_URL via your secure environment / secret manager.
# Provide OWNER_USERNAME, OWNER_NAME (optional), OWNER_PASSWORD as environment variables.
# OWNER_PASSWORD requires 12–200 characters; never commit these variables.
npx tsx scripts/create-owner.ts
```

The bootstrap refuses to replace an existing owner or run in demo mode. It records a password-free audit. After bootstrap, remove OWNER_PASSWORD from the shell or secret injection context. Create employee accounts in the owner UI. A password reset invalidates the employee's sessions, and deactivation immediately blocks access while preserving history.

`DATABASE_URL` is the runtime pooled PostgreSQL URL. `MIGRATION_DATABASE_URL`, if provided, is used only by migration commands (a direct/session-compatible connection is recommended). `DATABASE_SSL=true` enables certificate verification; set `DATABASE_SSL_CA` to the provider Root CA PEM (newlines or literal `\n` supported). Runtime uses Supabase transaction pooler port 6543; migrations use session pooler port 5432. `APP_ORIGIN` must match the public scheme and host exactly. No migration runs during app startup or API requests.

## Development seed and public configuration

`npm run db:seed` seeds an empty PostgreSQL database only when `ALLOW_SAMPLE_SEED=true`. It refuses non-empty databases. For local sample mode set `DEMO_MODE=true`: the first app request automatically creates `.data/demo.json`; an explicit seed command also works when the file is absent and refuses to overwrite an existing sample store. `DEMO_DATA_PATH` can point to an isolated test file. Demo is a single-process local verification facility; the server rejects demo transactions on Vercel.

`GET /api/config` is public and performs no database reads. It returns `demo` and `sampleLogin`. Quick sample-account buttons are enabled in local demo mode, or deliberately with `ENABLE_SAMPLE_LOGIN=true` for a development database containing sample accounts. On Vercel they require that explicit flag; leave it unset for production. The flag affects presentation only, never creates accounts and never bypasses authentication.

## Persistence and boundaries

Entity tables use JSONB payloads with generated relational columns, foreign keys, unique day/effective-date indexes and checks maintained by node-pg-migrate. All values are parameter-bound. A small serverless pool (maximum 1 connection per instance) is reused. Each state transaction acquires one connection and a PostgreSQL advisory transaction lock, loads entity state, and saves changed rows plus audits atomically. Retried clock requests use account-scoped idempotency keys. File demo uses an in-process queue and atomic file replacement.

This deliberately simple repository is suitable for a small single restaurant, but **loads all historical rows, sessions and request records and serializes all requests behind one lock**. Long-running multi-year datasets or larger concurrency will need scoped SQL queries, bounded retention of expired sessions/idempotency records, pagination and narrower employee-level locking. The current in-memory login throttle is per server instance; a multi-instance production environment should add shared rate limiting at the hosting boundary. These are known scaling constraints, not claims of high-volume readiness.

## Time, wage and period rules

Timestamps retain UTC millisecond precision; display and the immutable clock-in work date use Asia/Seoul. Paid duration is an integer millisecond difference minus the single configured deduction plus either 0 or 60 credited minutes. Missing checkout and invalid duration remain visible but are excluded from payroll. Actual short-shift checkout is always saved even if the default deduction requires correction. A correction of a confirmed row clears confirmation; a separate unchanged save confirms the corrected row.

Hourly pay uses the wage effective on the clock-in date. Daily won is computed from exact integer milliseconds with integer arithmetic and rounded half-up once per day, then summed. Display rounding never feeds into payroll. Monthly workers have attendance totals but `amount: null`. No statutory allowances, tax or insurance are automatically calculated.

Period days support 1–31; nonexistent dates clamp to that month's final day. Changes must start at an existing future boundary, leaving earlier periods intact. The first changed period may be shorter or longer to meet the next new boundary, so there are no gaps or overlaps. Completed, unconfirmed records are included in the estimate and counted as unconfirmed; incomplete/invalid and missing-wage hourly records are excluded and counted.

## Server-only database access

The second migration enables RLS without API policies on all application tables and the migration ledger, and revokes table access from PUBLIC and existing Supabase anon/authenticated/service_role roles. The server connects as the database owner using verified TLS. Migration rollback disables RLS but deliberately does not regrant API access. Supabase Auth, Data API, Realtime, Storage and Edge Functions are not used.
