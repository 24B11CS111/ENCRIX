# ENCRIX release and operations runbook

This runbook describes a controlled release path. It does not authorize a deployment, remote database write, payment, or live call. Keep actual credentials in the hosting provider's server-side environment settings; never commit them or put server secrets in `VITE_` variables.

## Current release gates

- The customer price is ₹9,999 INR per year. The one-time ₹10,000 onboarding fee is deferred and is neither payable nor included in checkout; no registration fee is charged. The public catalog exposes only the Business annual plan.
- Razorpay checkout is disabled in `api/_lib/billingPlans.ts`. Keep it disabled until staging has verified the provider plan, webhook lifecycle, reconciliation and approved test payments. A browser redirect must never activate a subscription.
- The OTP application code uses durable database RPCs for LOGIN and INVITATION attempts, but the latest migration `20261031150000_durable_email_otp_attempts.sql` still requires execution and real PostgreSQL concurrency verification. Do not describe OTP concurrency as database-verified before those checks pass.
- Twilio outbound two-leg calling and per-number inbound routing are implemented in the current local source. Execution is gated by `TWILIO_CALLING_ENABLED=false` by default; do not enable it before migrations and Test Account callbacks pass. No provider request was made during implementation.
- Organization Twilio Account SID and Auth Token are encrypted at rest through the AES-256-GCM keyring. Keep previous key IDs in the keyring during rotation until every organization's configuration is re-saved with the active key.
- Sanitized Realtime and public-leads privilege-hardening migrations have local regression tests; local catalog verification does not prove staging state. Reconcile every migration against the staging schema and history before applying any remote SQL.

## Environment configuration

Use `.env.example` only as a list of names. Use `.env.staging.example` as a staging template, and populate values only in the intended Vercel/Supabase/provider settings. Validate environment scopes and project references with an operator; never print environment values in CI logs or support notes.

Client-side values may include only the public Supabase URL and anon key. Server-side values include `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SERVER_SECRET`, `OTP_SERVER_SECRET`, email provider credentials, `CRON_SECRET`, and provider credentials. Supabase service-role, Razorpay secret, Twilio auth token and session/OTP signing secrets must never be exposed to browser code.

Use separate credentials and provider subaccounts for development and staging. For Razorpay, use Test Mode credentials and a verified Business plan ID; the application checks server-side plan details and does not trust a client-supplied amount. Each organization supplies its own Twilio account and number. The Twilio keyring requires `TWILIO_CREDENTIAL_ENCRYPTION_KEYS` (JSON mapping key IDs to base64-encoded 32-byte AES keys), `TWILIO_CREDENTIALS_ACTIVE_KEY_ID`, `TWILIO_PUBLIC_WEBHOOK_BASE_URL`, and `TWILIO_CALLING_ENABLED`. Keep the calling flag false until migration and sandbox checks pass.

## Pre-release checks

Run from a reviewed checkout:

```powershell
npm ci
npm test -- --maxWorkers=8
npm run lint
npm run build
git diff --check
```

Review the full diff and ensure no `.env` files, provider secrets, test fixtures, temporary database files, or unrelated user changes are included. Run dependency vulnerability review in an environment with a trusted registry connection; record the registry timestamp and findings rather than treating an offline result as a clean audit.

The local Supabase SQL suite requires a running, disposable Supabase stack backed by PostgreSQL 17 and a working Docker Desktop engine. Only after confirming the stack is local and disposable, run `npx supabase test db`. This command was not run in the current validation: Docker Desktop is installed but its daemon is unavailable, and `127.0.0.1:54322` is not listening. Port 5432 is occupied by an unidentified existing `postgres.exe` process; do not connect to, stop, or modify that service. The repository's Supabase CLI reports linked-project metadata; do not use commands that could target a linked remote project as a substitute for starting and verifying the local stack.

### Latest local validation snapshot (2026-11-06)

- `npm test`: passed, 90 test files and 1,008 tests. These are local tests, not persistent-database CRM workflows.
- `npm run build -- --outDir C:\Users\hrixo\.copilot\session-state\f6f48be0-a32d-4522-95cd-7e4d65a87fc3\files\build-check-20261106`: passed, including TypeScript and API checks. The largest emitted file is 729,407 bytes; the isolated build output was removed after verification, so the existing `dist` directory was not overwritten.
- `npm run lint`: exit 0 with 140 warnings (136 unused-variable warnings and 4 unnecessary-escape warnings); no lint errors.
- `git diff --check`: exit 0 with no whitespace errors.
- Database validation: blocked. Docker is unavailable, the local Supabase stack is not running, and the 41-migration chain plus 16 SQL regression tests were not run in this validation. No Production or staging migration was attempted.
- Infrastructure discovery: Docker Desktop and Supabase CLI 2.121.0 are installed; the Docker daemon is not running. A separate staging Supabase URL is configured locally (client/server project references match and differ from the production reference pinned in source); it was not contacted.
- Provider validation: no Razorpay or Twilio Test Mode request was made. No Razorpay Test Mode credential bundle is configured. Twilio credentials exist in the local staging file, but their Test Account status is unverified. Existing mocked tests are not provider verification.
- CRM workflow and backup recovery: no persistent two-organization CRM E2E or backup/restore was run; there was no safe disposable PostgreSQL instance. The existing PostgreSQL process on port 5432 was left untouched.
- Security: a read-only static source review reported no confirmed vulnerabilities; effective deployed grants/RLS, staging tenant workflows, provider settings, and production configuration remain unverified.

Production remains NO-GO until the database, staging, provider, backup/restore, and release-approval gates below have actual evidence.

## Database staging sequence

1. Confirm the exact staging project reference from the project owner. Never infer it from a local alias.
2. Capture an operator-approved database backup/snapshot and record its restore procedure before writes.
3. Export read-only migration history and catalog evidence. Compare every candidate migration's effects, definitions, grants, RLS, triggers, indexes and publication membership. A missing migration-history table does not prove that all migrations are pending.
4. Run each documented duplicate/data-compatibility preflight and save the results without customer data values.
5. Reconcile historical migrations individually. Baseline only versions whose effects have been verified. Never repair history or push the whole folder as a shortcut.
6. Apply only the reviewed pending migrations, in timestamp/dependency order, through the approved staging procedure. Stop on any unexpected statement or mismatch.
7. Execute SQL regression files against staging only after confirming each test ends with `ROLLBACK` and does not call external services. For OTP concurrency, use isolated unique fixtures and two or more independent PostgreSQL sessions; mocked Vitest tests are not a substitute.
8. Repeat read-only checks for RPC ownership and grants, RLS, effective ACLs, index/constraint definitions, sanitized Realtime publication membership, OTP RPC behavior and migration history.

Do not use `db reset` on a shared environment. Do not delete or rewrite customer records to make a migration pass. If preflight returns conflicts, stop and prepare a reviewed data-specific remediation plan.

## Staging application verification

Use dedicated owner and telecaller test accounts in a dedicated test organization. Identify every fixture with unique IDs and a recognizable test namespace. Record only fixture identifiers, never OTP values, phones, emails or credentials in shared logs. Verify owner registration/resend/expiry/replay, pending profile completion, CSV retry and persistence after reload, assignment and reassignment, telecaller assigned-only reads, cross-organization denial, custom OTP Realtime polling, and cache clearing at logout.

Razorpay tests require Test Mode and explicit approval for test payments. Verify duplicate/out-of-order webhooks, failed/abandoned checkout, retry/reconciliation and payment history. Do not enable checkout simply to run an E2E test. Twilio sandbox tests require an approved number per test organization and real provider configuration. Verify telecaller-first outbound bridge, inbound number-to-tenant/lead resolution, disabled/unassigned caller behavior, signature rejection and duplicate callback handling.

Clean up only the test records created by the run, using reviewed organization-scoped criteria. Keep webhook receipts and logs required for debugging only if they contain no secrets or raw lead contact data. Verify cleanup counts after each test phase.

## Deployment procedure (operator only)

No deployment is authorized by this document. After staging sign-off and explicit release approval:

1. Freeze and review the release commit; verify CI uses the intended project and production environment scope.
2. Create and review a Vercel preview deployment, then run the approved smoke tests against the preview without activating payment or calls.
3. Obtain release approval and confirm backup and rollback readiness.
4. The approved operator may run `vercel deploy --prod` from the reviewed release checkout. Do not run this command before that approval.
5. Verify health, auth, lead authorization, billing status, webhook delivery and error rates. Keep Razorpay checkout and Twilio live calling disabled until their separate readiness gates are signed off.

Rollback application code to the previous immutable deployment if the release is unhealthy. Database rollback is not assumed safe: prefer a forward fix, and restore a backup only through an incident-reviewed procedure that accounts for writes made after the snapshot.

## Backup, monitoring and incident response

- Before schema writes, confirm the Supabase backup/PITR coverage and the operator's restore access. For a manual export, use a trusted encrypted destination and protect the dump with the same controls as production data. Test restore procedures in an isolated environment, never by overwriting a shared database.
- For a local disposable PostgreSQL backup/restore check, use a cluster containing synthetic test data only and bind every client to loopback. Confirm the cluster/port is disposable before running commands; do not copy a Production or shared-database URL into the shell. Example PowerShell procedure:

  ```powershell
  $ErrorActionPreference = 'Stop'
  $DbHost = '127.0.0.1'
  $DbPort = 55439
  $SourceDatabase = 'encrix_disposable'
  $RestoreDatabase = 'encrix_restore_verification'
  $BackupFile = Join-Path $env:TEMP 'encrix-disposable.backup'

  if (-not (Test-NetConnection -ComputerName $DbHost -Port $DbPort -InformationLevel Quiet)) {
    throw 'The expected loopback PostgreSQL instance is not listening.'
  }
  if (Test-Path -LiteralPath $BackupFile) {
    throw 'The backup file already exists; choose a fresh path to prevent overwriting it.'
  }
  $existing = psql --host $DbHost --port $DbPort --username postgres --dbname postgres --tuples-only --no-align --command "SELECT 1 FROM pg_catalog.pg_database WHERE datname = '$RestoreDatabase'"
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify the restore database name.' }
  if ($existing.Trim() -eq '1') { throw 'The restore database already exists; choose a fresh disposable name.' }

  pg_dump --host $DbHost --port $DbPort --username postgres --format custom --no-owner --no-acl --file $BackupFile $SourceDatabase
  if ($LASTEXITCODE -ne 0) { throw 'The disposable database backup failed.' }
  pg_restore --list $BackupFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'The backup archive could not be read.' }

  createdb --host $DbHost --port $DbPort --username postgres $RestoreDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated restore database.' }
  pg_restore --host $DbHost --port $DbPort --username postgres --dbname $RestoreDatabase --exit-on-error --no-owner --no-acl $BackupFile
  if ($LASTEXITCODE -ne 0) { throw 'The disposable restore failed; preserve the archive and investigate.' }
  psql --host $DbHost --port $DbPort --username postgres --dbname $RestoreDatabase --set ON_ERROR_STOP=1 --command "SELECT current_database(), current_setting('server_version'), count(*) AS restored_application_tables FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"
  if ($LASTEXITCODE -ne 0) { throw 'The restored database verification query failed.' }
  ```

  Keep the archive in an access-controlled local location, verify the restored database name and expected synthetic fixture counts, and record the PostgreSQL client/server versions. Remove the archive and restore database only after recording the result and re-confirming the exact disposable paths/names. This procedure is for an isolated local cluster, not a production backup or restore.
- A separate synthetic native PostgreSQL 17.11 cluster bound only to `127.0.0.1` was used to verify `pg_dump`/`pg_restore`; two synthetic organizations, two profiles, three leads, two follow-ups, two billing rows, and seven indexes matched after restore. This was not a Supabase platform/full-schema restore and contained no customer data. In the latest validation, the local Supabase CLI was present, but the Docker Desktop engine was unavailable and the local database port was not listening; no full migration chain or SQL regression suite was run.
- Monitor API 5xx/latency, OTP issue/verify failures and lockouts, database RPC errors, organization authorization denials, billing reconciliation-required states, webhook signature failures/replays, Twilio callback failures, and reminder job outcomes.
- Logs must use event IDs, safe error codes and masked identifiers. Never log OTP values/hashes, session tokens, authorization headers, payment secrets, Twilio auth tokens, full lead phones/emails, or raw webhook bodies.
- On suspected cross-tenant access, credential exposure, forged webhook or unauthorized payment-state change: disable the affected server feature through the approved operator process, preserve relevant redacted evidence, rotate affected secrets, review audit/security events and provider logs, and follow the incident response owner. Do not delete logs or customer records during investigation.

## Current launch blockers

1. Apply and validate the durable OTP migration in a disposable/local PostgreSQL environment and then through a separately approved staging migration plan; prove attempt limits with concurrent sessions.
2. Apply and locally validate `20261031160000_organization_twilio_calling.sql`, then run outbound and inbound test calls for separate Twilio test organizations before enabling the server gate.
3. Verify staging's effective grants, RLS, RPCs, migration state and end-to-end workflows.
4. Complete Razorpay Test Mode lifecycle/reconciliation checks before any checkout enablement.
5. Resolve production release approval, backup/restore readiness and deployment ownership.
