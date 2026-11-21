# ENCRIX Staging Integration Checklist

**Purpose:** Record completed local-only database validation and prepare a controlled staging integration run. No secrets were read, no external emails/payments/refunds/calls were sent, no remote migrations were applied, and no provider or deployment settings were changed.

## Readiness summary

The local database gate passed on 2026-11-09: 41/41 repository migrations and 16/16 SQL regression scripts passed on an isolated Supabase-compatible PostgreSQL 17 database. Catalog and two-organization checks also passed. An additional 21 local mock-based test files passed (322 tests). ENCRIX is **not ready for a staging acceptance sign-off**: no hosted staging target could be identified safely, and no browser-based staging or live-provider E2E was run.

## Staging target discovery (2026-11-09)

- Vercel CLI 64.5.0 is installed, but `.vercel/project.json` is absent. No Vercel project is linked locally. No `vercel env` command or remote project query was made.
- The Supabase CLI is available as a repository dev dependency. A local `supabase/.temp/project-ref` marker exists, but its value was not read; it is not known to identify staging and was not used for any remote command.
- `.env.local`, `.env.staging`, and `.env.production` exist locally. No values were read, printed, validated, or copied. Their presence does not establish that any value is staging-only or usable. The variable names in `.env.staging` do not include Razorpay or Resend configuration or the OTP/session signing secrets; its Twilio variable names do not prove Test credentials. Do not start the app with this file or send provider requests until an authorized operator verifies staging-only values out of band.
- The local `supabase/config.toml` Auth settings use `http://127.0.0.1:3000` as the Site URL and `https://127.0.0.1:3000` as the additional redirect. These are local settings, not hosted staging settings.
- No hosted Supabase or Vercel settings were inspected or changed, no deployment was made, and no remote migration command was run.

### Approval and provisioning needed

1. Provide/identify a dedicated **non-Production** Supabase staging project and approve an operator to verify its project identity without exposing keys. Keep the local project-reference marker out of remote commands until it is classified.
2. Provide/identify the dedicated Vercel Staging project and confirm its preview/staging domain, deployment protection/access, Vite framework, `npm run build:staging` build command, `dist` output directory, and Node runtime. No deployment is authorized by this checklist.
3. Configure Auth Site URL as `https://<staging-host>` and allow only the required staging redirects, including `https://<staging-host>/reset-password` and `https://<staging-host>/accept-invitation`. Do not add Production or broad wildcard origins.
4. Configure custom email OTP with a staging-only Resend key and verified staging sender, plus distinct staging `OTP_SERVER_SECRET` and `SESSION_SERVER_SECRET`. Supabase Auth SMTP is separately required for native password-recovery mail. Use controlled test inboxes only.
5. Configure Razorpay Test Mode credentials, the matching INR 9,999/year test plan, finite subscription count, and a staging webhook secret at `https://<staging-host>/api/billing/webhook`. Keep server secrets out of all `VITE_` variables. Checkout is currently disabled in the application plan, so provider subscription E2E remains blocked until its intended staging enablement is explicitly approved and verified.
6. Configure a test-only Twilio account and approved test destinations out of band. Set the staging public HTTPS callback base to `https://<staging-host>`; voice and status callbacks must be signature-verified at `/api/telephony/voice` and `/api/telephony/webhook`. Keep `TWILIO_CALLING_ENABLED=false`; the user prohibited real calls, so no outbound or inbound provider call should be attempted in this phase.
7. Review required Staging-scoped variables in the table below using presence/format checks only; never print them. Keep Production scopes untouched. No external configuration changes are authorized by this checklist.

## Local infrastructure and database verification

### Observed local state

- Docker Desktop was installed; its Linux engine was initially stopped. Starting it resolved the infrastructure blocker.
- The native `postgresql-x64-17` service was already listening on port 5432. It was left running and was not used for validation.
- Existing Supabase containers included project `ENCRIX` on port 54322. Do not run `supabase db reset` against that project.
- Validation used a temporary, uniquely named Supabase project on PostgreSQL port 56422. The database-only stack has a separate project ID and leaves the existing PostgreSQL and Supabase services untouched.
- The required Supabase CLI is already a repository dev dependency; use `npx --no-install supabase`. The verified version is 2.121.0.

### Exact Windows PowerShell setup and validation commands

Run from the repository root. This creates a fresh temporary work directory and project ID for every run, copies migrations/tests into it, and uses ports separate from the existing ENCRIX stack.

```powershell
Start-Process "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
docker info
npx --no-install supabase --version

$projectId = "encrix-validation-$([guid]::NewGuid().ToString('N').Substring(0,12))"
$root = Join-Path $env:TEMP ("encrix-db-validation-" + [guid]::NewGuid().ToString('N'))
Write-Output "Validation project ID: $projectId"
Write-Output "Validation root: $root"
$sp = Join-Path $root "supabase"
New-Item -ItemType Directory -Force -Path "$sp\migrations", "$sp\tests" | Out-Null
Copy-Item .\supabase\migrations\*.sql "$sp\migrations"
Copy-Item .\supabase\tests\*.test.sql "$sp\tests"
@"
project_id = "$projectId"

[api]
enabled = false
port = 56421

[db]
port = 56422
shadow_port = 56420
major_version = 17
health_timeout = "2m"

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = false
sql_paths = []
"@ | Set-Content (Join-Path $sp "config.toml") -Encoding utf8

npx --no-install supabase start --workdir $root --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor --yes
npx --no-install supabase migration list --local --workdir $root

$containerId = docker ps --filter "name=supabase_db_$projectId" --format "{{.ID}}" | Select-Object -First 1
if (-not $containerId) { throw "Isolated database container was not found." }
docker exec $containerId mkdir -p /tmp/encrix-regression-tests
docker cp .\supabase\tests\. "${containerId}:/tmp/encrix-regression-tests"
foreach ($test in (Get-ChildItem .\supabase\tests\*.test.sql | Sort-Object Name)) {
    docker exec $containerId psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f "/tmp/encrix-regression-tests/$($test.Name)"
    if ($LASTEXITCODE -ne 0) { throw "SQL regression failed: $($test.Name)" }
}
```

The local Supabase CLI applies migrations on first start. The `migration list --local` check must show every local migration applied. These SQL scripts use `psql` assertions and rollback-only fixtures; they are not pgTAP files, so run them with the loop above rather than `supabase test db`. The `--local` flag and temporary project are required; do not link a remote project. To stop only the disposable project and retain its volume for a later run, use the generated `$projectId` from the same PowerShell session:

```powershell
npx --no-install supabase stop --project-id $projectId
```

Never use `supabase stop --all`, `supabase db reset` from the repository's normal `supabase` directory, or the default ENCRIX project ID for this validation.

If Docker Desktop is not installed on a Windows machine, install it with `winget install --id Docker.DockerDesktop -e`, enable its WSL 2 engine, and restart Windows if the installer requests it. Confirm with `wsl --status`, then start Docker Desktop and require `docker info` to succeed before continuing. Do not stop or reconfigure an existing PostgreSQL service to make room.

### Results recorded on 2026-11-09

- 41/41 timestamp-ordered repository migrations applied; all 41 appear in the local migration history.
- 16/16 SQL regression scripts passed; 0 failed.
- RLS enabled on 35/35 public tables; 0 API-readable public tables without RLS.
- 64 public functions, including 62 SECURITY DEFINER functions; 0 SECURITY DEFINER functions lacked a configured `search_path`.
- 8 user triggers; 0 disabled. 198 public constraints; 0 unvalidated.
- The Phase 23.8 and Phase 24.7 tests used separate organizations and confirmed tenant-scoped reads and updates; all fixture changes rolled back.
- This local evidence does not certify or apply migrations to any hosted Supabase project.

### Local application test results (not staging E2E)

Ran Vitest with provider/database credential environment variables removed from the test process. **21 files passed; 322 tests passed; 0 failed.** Provider-dependent API behavior was exercised with mocks; no external requests were made. Exact test file names are recorded in the [release report](../RELEASE_CANDIDATE_REPORT.md#local-application-test-run-2026-11-09).

Coverage included OTP and login/logout behavior, invitation acceptance/management, owner onboarding, leads and dashboard, follow-up, simulated Razorpay lifecycle/webhooks/refund decisions, entitlement/cancellation policy, telephony callback/recording authorization, and security/isolation. This is code-level local evidence only; it does not prove a staging browser flow, email delivery, external webhook, or provider transaction.

| Requested staging flow | Staging result | Local evidence |
|---|---|---|
| Owner registration, OTP, login/logout, business profile/onboarding | NOT RUN — no verified staging target or controlled inbox | Mock/unit tests passed; persistent session revocation SQL regression passed in the prior local DB run |
| Telecaller invitation, activation/login, organization scope | NOT RUN | Invitation, auth and tenant isolation tests passed locally with mocks/SQL fixtures |
| Lead create/assign/update, follow-up, dashboard/reporting | NOT RUN | Local lead, follow-up and dashboard tests passed |
| Admin refund request, review, approve/reject | NOT RUN | Mock-based authorization and refund policy tests passed; no provider refund |
| Partial/full refund entitlement outcomes | NOT RUN | Local SQL entitlement/refund regression and mock policy contracts passed |
| Cancellation at period end / expired access | NOT RUN | Cancellation API and local entitlement contracts passed; no staging subscription |
| Razorpay Test Mode checkout/webhook/idempotency/failed payment | NOT RUN | Signature/idempotency/lifecycle mocks and SQL tests passed; checkout is currently disabled; no provider request |
| Twilio signed callbacks, call status, recordings, reminders | NOT RUN | Local callback/recording/follow-up tests passed with mocks; no phone numbers or Twilio credentials used |

No staging screenshots or logs exist for this run; none were fabricated. No hosted identity or real staging data was created.

### Confirmed implementation facts

- Server Supabase access uses `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` (or the legacy alias `SUPABASE_SERVICE_KEY`). API code rejects non-real/placeholder server configuration.
- The frontend uses `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; server-only keys must never use a `VITE_` prefix.
- Custom auth uses `OTP_SERVER_SECRET` and `SESSION_SERVER_SECRET`; email OTP uses Resend, with SendGrid fallback.
- The owner-configured Twilio account is validated against Twilio, encrypted server-side, and stored per organization. Outbound calling is explicitly disabled unless `TWILIO_CALLING_ENABLED === "true"`.
- Razorpay configuration rejects non-Test-Mode key IDs. The Business plan draft is ₹9,999 INR yearly, interval 1. The API requires an explicit Razorpay plan ID and total charge count; it does not infer defaults.
- API route rewrites exist for auth, billing, leads and follow-up reminders. Billing disables automatic body parsing so webhook signature validation can use raw request bytes.
- The centralized subscription gate reads authoritative database state on server routes. Billing and checkout endpoints remain accessible to allow payment/renewal after expiry. Enforcement is always on; no environment flag bypasses the database authority.

## Environment variables

Populate these only in the **Vercel Staging** environment scope and in the staging build environment as applicable. Never copy production values. This audit lists names only and does not inspect configured values.

| Name | Classification | Purpose / staging rule |
|---|---|---|
| `VITE_APP_ENV` | Frontend build / environment | Set to the staging environment marker; avoid a production marker. |
| `VITE_ENABLE_DEMO_SANDBOX` | Frontend feature flag | Must be `false` in staging so demo data/persona behavior cannot replace real API flows. |
| `VITE_USE_LIVE_API` | Frontend feature flag | Set to `true` for staging API integration testing. A configured Supabase client can also select live mode, but explicit staging intent is clearer. |
| `VITE_APP_URL` | Frontend / URL | Staging origin used by browser flows where configured. |
| `VITE_SUPABASE_URL` | Frontend-safe / database | Staging Supabase URL only. |
| `VITE_SUPABASE_ANON_KEY` | Frontend-safe / database | Staging anon key; RLS remains required. This key is public by design. |
| `SUPABASE_URL` | Server / database | Same staging project URL. Required for server-backed flows. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server secret / database | Staging service-role key. Keep only in Vercel server environment; never expose to Vite/browser. `SUPABASE_SERVICE_KEY` is a code-supported legacy alias; prefer the canonical name. |
| `SESSION_SERVER_SECRET` | Server secret / authentication | Random, high-entropy HMAC signing secret; distinct from OTP secret and all other environments. |
| `OTP_SERVER_SECRET` | Server secret / authentication | Random, high-entropy OTP HMAC secret; distinct from session secret. |
| `APP_URL` | Server / callback and invitation URL | Canonical HTTPS staging origin. Used for invitation URLs and as a fallback for Twilio webhook origin. Set explicitly to prevent request-host-derived or localhost fallback URLs. |
| `RESEND_API_KEY` | Server secret / email OTP | Staging email-provider key. Do not use a production API key for test sends. |
| `RESEND_FROM_EMAIL` | Server / email OTP | Sender identity on a verified staging sender domain. Resend fallback sender in code is not evidence that a sender domain is verified. |
| `SENDGRID_API_KEY` | Optional server secret / email fallback | Alternative provider used only when Resend is not configured. Prefer one provider to make delivery behavior observable. |
| `SENDGRID_FROM_EMAIL` | Optional server / email fallback | Required if the SendGrid fallback is chosen; must be a verified sender. |
| `RAZORPAY_KEY_ID` | Server secret/config / billing | Test Mode key only; code requires the `rzp_test_` prefix. |
| `RAZORPAY_KEY_SECRET` | Server secret / billing | Matching Test Mode secret. Never place in frontend variables. |
| `RAZORPAY_WEBHOOK_SECRET` | Server secret / billing | Secret configured for the staging webhook endpoint; required for webhook route. |
| `RAZORPAY_PLAN_BUSINESS` | Server config / billing | Test Mode plan ID whose provider-side plan is INR 9,999 per year, interval 1. Verify amount and period through Razorpay before checkout. |
| `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT` | Server config / billing | Explicit positive number of yearly charges for the test subscription. No default is provided; choose a finite count appropriate for a disposable test subscription. |
| `TWILIO_CREDENTIAL_ENCRYPTION_KEYS` | Server secret / Twilio | JSON key ring mapping key IDs to canonical Base64-encoded 32-byte AES-256 keys. Keep old keys during rotation until all stored credentials are re-encrypted/retired. Do not generate or paste a key in this document. |
| `TWILIO_CREDENTIALS_ACTIVE_KEY_ID` | Server config / Twilio | Must identify a key present in the key ring. |
| `TWILIO_PUBLIC_WEBHOOK_BASE_URL` | Server / Twilio callbacks | Public HTTPS origin for staging callbacks. If absent, code falls back to `APP_URL`, then Vercel's production URL variable. Set the staging value explicitly. |
| `TWILIO_VOICE_WEBHOOK_URL`, `TWILIO_STATUS_CALLBACK_URL` | Optional server / Twilio callbacks | Full HTTPS callback URL overrides. Leave unset to derive route paths from the verified staging public base URL. |
| `TWILIO_CALLING_ENABLED` | Server feature flag / Twilio | Keep false until migrations, credentials, signature callbacks, and controlled provider tests pass. Only then enable for staging. Never treat this as production activation. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` or `TWILIO_CALLER_ID` | Server secret / legacy SMS OTP | `otpServer.ts` can use these for phone-enrollment SMS. These are platform-level SMS credentials and are separate from each organization's encrypted voice account. Provision only if SMS OTP is part of the staging test; use a restricted staging account and test recipient. |
| `CRON_SECRET` | Server secret / scheduled work | Strong random bearer secret (production validator requires at least 32 characters and rejects placeholders). Store only in server environment. |
| `ENABLE_FOLLOWUP_EMAIL_REMINDERS` | Server feature flag | Keep false until the outbox migration is applied and validated. When enabled, verified recipients are sent through the service-role-only outbox using Resend. |
| `ENCRIX_LOCAL_OTP_TRANSPORT` | Local-only setting | Must be absent in staging. The `mailpit` value is explicitly restricted to local development. |
| `VITE_TELEPHONY_PROVIDER` | Frontend / legacy provider selector | Keep `mock` for staging unless a separately reviewed browser provider flow is explicitly required. Current secure live calls use server APIs; do not expose customer credentials. |
| `JWT_SECRET` | Staging template only / unverified | No application source reference was found. ENCRIX API auth uses the two HMAC secrets above and Supabase `auth.getUser`; do not assume this template variable configures ENCRIX auth. |
| `NEXT_PUBLIC_APP_URL` | Optional legacy URL fallback | Invitation URL code supports it after `APP_URL` and `VITE_APP_URL`; prefer `APP_URL` in server environment. |
| `NODE_ENV`, `VERCEL`, `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL` | Platform-provided | Do not manually repurpose. The code reads these for production checks/deployment URL fallback. |
| `TEST_LIVE_API`, `VITEST` | Test-only | Not staging runtime settings. |

### Variable-template discrepancies

- `.env.staging.example` now lists the Razorpay Test Mode, reminder, cron, encryption, public and server-only names. It contains placeholders only; actual Vercel Staging scope values have not been inspected or changed.
- `.env.staging.example` is a names-only staging template; verify required values in the Vercel Staging scope before use.
- The obsolete `SUBSCRIPTION_ENFORCEMENT_ENABLED` variable has been removed; paid entitlement checks are unconditional. `.env.example` is a general local-development template and does not repeat the staging-only values in this checklist.
- `JWT_SECRET` appears in the staging example but has no ENCRIX application references found. Confirm whether an external platform expects it before setting it; it is not a substitute for the named HMAC secrets.

## Provider readiness

### Supabase

1. Create/use a dedicated staging Supabase project, separate from production.
2. Set the project URL and anon key in the staging frontend build scope and the URL/service-role key in the Vercel Staging server scope.
3. Local PostgreSQL 17 migration/catalog validation passed as recorded above. Before app E2E, separately review the intended migration set for the dedicated staging project; no hosted/staging migration has been applied or certified here.
4. Verify effective RPC grants, RLS policies, tenant isolation, sanitized Realtime publication membership, billing constraints and the paid-entitlement RPC after migration validation.

### Resend / email

1. Use a Resend staging key and a sender address on a verified staging domain (DNS verification, including provider-required SPF/DKIM records, must be complete).
2. OTP send is implemented through Resend, with SendGrid fallback. Test only controlled mailboxes and verify delivered, expired, invalid, resend/cooldown, and rate-limited behavior.
3. Invitation creation now sends the persisted, email-bound, expiring single-use link through Resend. Provider failure is returned as a failure and retry reuses the pending token. Test only controlled addresses.
4. Password recovery uses Supabase Auth's native single-use, time-limited recovery flow and global sign-out after password change. Configure Supabase Auth SMTP with the verified Resend sender and allow the staging `/reset-password` redirect. OTP-only profiles without a matching Supabase Auth user have no password credential to reset and continue to use OTP login.
5. Do not send real customer email during this preparation. Staging E2E must use designated test inboxes.

### Twilio

1. Each test organization supplies its own Account SID, Auth Token, and voice-capable E.164 number through `/api/telephony/config`; the server validates account/number ownership and encrypts credentials using the staging key ring.
2. Set `TWILIO_PUBLIC_WEBHOOK_BASE_URL` to the staging HTTPS origin. Generated URLs are:
   - Voice/inbound: `https://<staging-host>/api/telephony/voice`
   - Status and call callbacks: `https://<staging-host>/api/telephony/webhook`
3. Twilio signatures are validated against the configured canonical URL and the matching organization's Auth Token. Verify the public staging URL, proxy path, query parameters, form body, and signature end to end before enabling calls.
4. Current call creation sends voice URL and status callback. There is no distinct recording-status callback parameter/route configured. The status webhook can consume a `RecordingUrl` if Twilio includes it, but the call setup reviewed here does not itself request recording. Treat recording capture as unsupported until a separate controlled test proves it.
5. Keep `TWILIO_CALLING_ENABLED=false` until all checks below are signed off. Begin with a test org, a test-owned Twilio account/number, one assigned test lead, and an approved test destination. Never use customer records or unapproved recipients.
6. Legacy platform Twilio environment credentials are used by the phone-enrollment SMS helper, while customer-owned encrypted credentials are used for voice calling. Test and account for this distinction; do not use one tenant's voice credentials for another tenant.

### Razorpay

1. Create a Test Mode Business plan in Razorpay matching INR 9,999/year, interval 1, and the explicitly selected positive total count.
2. Set `RAZORPAY_KEY_ID` to a Test Mode ID and pair it with the matching Test Mode key secret. Set the test plan ID and webhook secret in the Staging server scope only.
3. Configure webhook endpoint `https://<staging-host>/api/billing/webhook`; preserve the raw request body and configure the same endpoint secret in Razorpay.
4. The handler validates signature and event ID, deduplicates webhook receipts, re-fetches subscription/payment state from Razorpay, checks plan/amount/currency/organization identity, and applies payment/subscription state through the atomic RPC. Do not activate access from the browser redirect.
5. Configure subscription/payment events that include subscription or payment entities used by this handler. At minimum, exercise payment authorized/captured/failed/refunded and subscription activated/charged/updated/halted/cancelled/completed events available in the Test Mode account; verify the exact delivered event names and entity payloads in Razorpay's webhook tester before accepting the configuration.
6. Reconciliation endpoint: `POST https://<staging-host>/api/billing/reconcile`; authenticated owner only. Do not use it to create a provider subscription; it is for securely attaching an already-existing matching subscription.
7. Keep all test keys and test plan IDs in Staging scope. Never copy live keys or configure production checkout as part of this plan.

## Vercel deployment configuration review

- `vercel.json` contains rewrites for auth, billing, leads, follow-up reminders, and global security headers. The billing handler disables body parsing for raw signature verification. Configure Vercel Staging as a Vite project with `npm run build:staging` and `dist`; verify the Staging deployment uses the intended preview domain and access protection.
- No `crons` entry exists in `vercel.json`. `/api/followups/reminders` rewrites to `/api/cron/follow-up-reminders`; the function now has a 30-second execution bound, but no schedule is configured. A five-minute interval is recommended for the existing 15-minute upcoming-reminder window; adding it requires separate operational approval. Do not assume it runs automatically.
- `/api/health` reports liveness by default and readiness via `?probe=ready`; readiness checks essential configuration and performs a bounded database probe without returning internal values.
- `vercel.json` has no explicit function runtime or Node version declaration; `package.json` has no `engines.node` pin. Confirm the Vercel Staging project runtime is compatible with Node APIs used by the handlers before deployment.
- Repository configuration does not reveal actual Vercel environment-variable scopes or values. The Vercel dashboard's Staging scope must be reviewed by an authorized operator without printing secrets. Production scopes must remain untouched.
- No explicit error-monitoring/analytics provider variables were found. Vercel logs are the current observable source; verify alerting/retention and redact any application logs before launch.

## Exact routes used by staging tests

| Purpose | Method and route |
|---|---|
| Send owner/telecaller email OTP | `POST /api/auth/send-otp` |
| Verify OTP / complete auth flow | `POST /api/auth/verify-otp` |
| Password recovery email | Supabase Auth `resetPasswordForEmail` redirects to `/reset-password` |
| Application health/readiness | `GET /api/health` and `GET /api/health?probe=ready` |
| Owner registration session | `POST /api/auth/session` (route-specific body and verified-ticket requirements apply) |
| Create invitation | `POST /api/auth/invite` |
| Validate invitation link | `GET /api/auth/invite?token=<test-token>` |
| Manage invitation list/revoke | `GET` / `DELETE /api/auth/invitations` |
| Business plan list | `GET /api/billing/plans` |
| Create Test Mode checkout | `POST /api/billing/checkout` |
| Verify browser payment result server-side | `POST /api/billing/verify` |
| Razorpay webhook | `POST /api/billing/webhook` |
| Billing state/history | `GET /api/billing/subscription` |
| Reconcile existing provider subscription | `POST /api/billing/reconcile` |
| Request refund review | `POST /api/billing?_route=refund-request` |
| Admin refund queue/detail/review | `GET /api/billing?_route=refund-requests`, `GET /api/billing?_route=refund-detail`, `POST /api/billing?_route=refund-review` |
| Request subscription cancellation | `POST /api/billing?_route=cancel-subscription` |
| Save/read org Twilio configuration | `PUT` / `GET /api/telephony/config` |
| Outbound call start/status/end | `POST` / `GET /api/telephony/call` |
| Incoming Twilio voice route | `POST /api/telephony/voice` |
| Twilio call status callback | `POST /api/telephony/webhook` |
| Recording access | `GET /api/telephony/recording` (recording production itself is not currently established) |
| Lead import / owner lead APIs | `POST /api/leads` and owner subroutes via `/api/leads/owner`, `/api/leads/owner/create`, `/api/leads/owner/assign` |
| Scheduled follow-up processor | `GET` or `POST /api/followups/reminders` with `Authorization: Bearer <CRON_SECRET>`; no schedule exists in Vercel config |

All route examples use the staging origin and dedicated test identities. Never paste a real token into logs or issue trackers.

## Controlled staging end-to-end scenarios

Run only after the staging database migration/catalog gate is approved, the test org and controlled identities are prepared, and provider credentials are confined to staging. Record request IDs and redacted outcomes; do not record OTPs, secrets, full phone numbers, or payment credentials.

1. **Owner registration:** Use a unique controlled owner email/business identity. Expect the pending registration and business details to persist once; a duplicate should receive a clear duplicate-account response, not a second org.
2. **Email OTP:** Send to the controlled inbox; reject invalid/expired/replayed tickets; verify exactly once; verify resend invalidates prior ticket and cooldown/rate limits hold. OTP must not appear in responses or logs.
3. **Organization onboarding:** Complete registration and reload the owner profile. Confirm organization and business details persisted, ownership links are correct, and no paid entitlement exists before a verified captured payment.
4. **Razorpay Test Mode subscription:** Open checkout as the owner. Confirm Business ₹9,999/year, INR and no onboarding/registration fee. Reject tampered signature, amount/currency/organization mismatch and browser-only success. Use Razorpay test payment methods only.
5. **Entitlement activation:** Before payment, paid CRM endpoints return `402 ACTIVE_SUBSCRIPTION_REQUIRED`. After valid captured payment/webhook or server-verified callback and confirmed database state, paid endpoints allow only the paying organization. Duplicate webhook delivery must remain idempotent.
6. **Telecaller invitation:** Create invitation as paid owner; verify Resend sends the link to the normalized intended email and organization, TELECALLER role, expiry and single-use state match. Duplicate requests reuse the pending link; provider failure must not claim delivery; accept once and reject duplicate/revoked/expired acceptance.
7. **Lead CSV import:** Import a small test CSV; verify imported/rejected/duplicate row counts, organization scope, assignment behavior, audit data and persistence after page reload. Retry same import and confirm no duplicate rows.
8. **Lead assignment:** Assign a test lead to the active telecaller in the same organization. Verify owner sees tenant leads, telecaller sees only assigned leads via authorized API, and cross-organization access is denied.
9. **Twilio outbound:** Only after separate approval to turn on staging calling, configure a test organization's own account. Confirm verified caller phone, assigned lead, server-generated callbacks, Twilio signature validation, idempotent call SID persistence, and no raw phone data in logs. Use a controlled test number.
10. **Incoming call routing:** Place an inbound test call to the organization's configured number. Confirm routing only when there is exactly one matching tenant/lead/active assigned caller. Ambiguous, unmatched, unavailable or non-entitled cases must fail closed and be recorded without leaking caller/lead PII.
11. **Status callback:** Deliver signed status callbacks for initiated/ringing/answered/completed and out-of-order/duplicate events. Confirm state only advances, callback identity is tenant-bound, invalid signatures are rejected, and no call or payment state is fabricated.
12. **Expiry and renewal:** Confirm billing/status/history and checkout remain accessible after expiry. Paid CRM endpoints must deny expired access. Renewal must require a new verified captured payment and valid current period. Do not directly update staging subscription rows for this test; use an approved provider test lifecycle or a disposable local SQL fixture. Until such a safe expiry mechanism exists, mark this case blocked rather than asserting a mocked result.

### Required role-based end-to-end sequences

- **Owner:** Register with a unique synthetic identity → receive and verify email OTP in a controlled test inbox → complete organization setup → dashboard reload → create/invite a telecaller → accept the invitation using the invited identity → import a small synthetic lead CSV → verify row counts, assignments, organization scope, audit history, and persistence after reload.
- **Telecaller:** Accept the organization-bound invitation → OTP login → verify only assigned leads are visible → record a call outcome and follow-up for an assigned lead → verify persistence and owner visibility. Do not place an actual Twilio call; use the local SQL fixtures for call-state behavior and mark provider call verification blocked.
- **Admin:** Review the synthetic billing record → inspect a refund request → verify authorized manual approve/reject paths and immutable audit history. Do not initiate a Razorpay refund; use local SQL/unit fixtures for refund state transitions until an approved Test Mode-only workflow is available.
- **Billing:** Create a Razorpay Test Mode checkout → verify a signed, deduplicated webhook in Test Mode → confirm server-side entitlement is granted only after verified payment → cancel through the supported lifecycle → review refund request/status. Never accept browser-only success as payment evidence. Do not make a real payment or refund.

These are prepared staging test steps, not completed E2E results. No staging identities, test inboxes, provider credentials, or deployment were provisioned or used during this preparation; external configuration was not inspected.

## Blockers and cautions

### Staging/provider gates still open

- No dedicated hosted Supabase staging project or Vercel staging deployment was selected, inspected, or changed. Review access and project identity without printing secrets, then approve a staging-only migration plan separately.
- No staging environment values were read or changed. Configure frontend-safe and server-only variables in the Staging scope only; validate presence/format without printing values. Never copy Production secrets.
- No OTP emails, Razorpay checkout/payment/refund, Twilio calls, or provider callbacks were sent or invoked. Provider verification remains outstanding.
- No browser-based OWNER, TELECALLER, ADMIN, or BILLING E2E sequence was run.
- Do not enable Twilio calling or follow-up email reminders until their staging configuration, migration, signed callback, and controlled recipient gates pass.
- The Business plan, payment constraints, webhook idempotency, service-role function grants and entitlement function passed local PostgreSQL 17 checks; hosted staging behavior remains unverified.

### Application/config gaps found

- **Supabase Auth recovery SMTP:** configure/test the provider-side SMTP sender and redirect allowlist. OTP-only accounts without a corresponding Auth user do not have a password credential to reset.
- **No scheduled cron:** Vercel config has the rewrite and a bounded execution time but no schedule. A five-minute interval is recommended for the reminder window; schedule configuration requires operational approval.
- **Health endpoint:** implemented locally; validate readiness against the staging-only database after migrations. An explicit Node runtime pin remains absent and must be confirmed in Vercel settings.
- **Follow-up email reminders require migrations:** a service-role-only outbox and Resend dispatcher are implemented locally with unique event claims and no automatic retry for uncertain delivery. Apply and validate the outbox migration before enabling the feature flag; keep it false until then.
- **No separate recording callback/recording request was found in current call creation:** recording E2E is blocked until a controlled recording configuration is reviewed.
- **Entitlement enforcement:** unconditional and backed by the database RPC; no rollout variable exists. Verify the policy and migration before staging paid operations.
- **Shared SMS credentials:** phone enrollment can use platform Twilio SMS environment credentials, distinct from organization-owned voice credentials. Confirm cost/account ownership and test restrictions before enabling SMS enrollment for external testers.
- **Staging env template:** updated locally with required variable names and no production reference; actual values still require staging-only configuration.

## Safe activation sequence

1. **Complete:** PostgreSQL 17 migration and catalog verification passed on an isolated local database.
2. Review a staging-only Supabase migration plan, backup/restore ability, duplicate/data preflights, RLS/RPC/ACLs, and the exact migration set. No remote migration is authorized in this task; any later staging migration needs a separate explicit approval.
3. Set frontend-safe and server-only environment variables in Vercel **Staging** scopes. Verify values by presence/format only, never print them. Keep production scopes untouched.
4. Configure Resend with a verified staging sender and controlled inboxes; configure Supabase Auth SMTP/redirects; test OTP and password recovery without real customer addresses.
5. Configure Razorpay Test Mode plan/keys/webhook, confirm plan and event payloads, then test checkout only in the staging origin.
6. Complete owner registration, payment verification, entitlement and CRM isolation tests before enabling any call operation.
7. Configure one disposable org's Twilio credentials with the required encryption key ring; validate account/number and signed callback URLs while `TWILIO_CALLING_ENABLED=false`.
8. Obtain explicit operational approval to set the **Staging-only** Twilio flag true for a controlled test window. Test one outbound and one inbound call with controlled numbers, then turn the staging flag off and verify no calls can start.
9. Verify expiry/renewal with an approved test mechanism; verify callbacks, health probes, reminder outbox behavior, logs, monitoring, and test-data cleanup. Do not use production credentials or customer contact data.
10. Keep live Razorpay keys, production configuration, production data, and deployment operations outside this checklist and require separate release approval.

## Final recommendation (2026-11-09)

**NO-GO for controlled staging acceptance today.** The infrastructure and local database gates passed, and 322 mock-based local application tests passed. However, the staging project and domain are not verified; local env files are not verified as staging-only; Razorpay checkout is disabled; and all hosted/browser/provider workflows remain unexecuted. There are no staging screenshots or provider logs to attach.

Before acceptance testing, obtain approval/inputs to identify the dedicated non-Production Supabase and Vercel projects, verify their identity without exposing credentials, approve Staging-scope configuration changes, and decide whether to enable the currently disabled checkout in staging. Never access Production or cause money movement, real recipient calls, or uncontrolled email delivery. Any later sandbox-only simulations must use verified test credentials and synthetic identities. Do not deploy or run remote migrations without separate explicit approval.
