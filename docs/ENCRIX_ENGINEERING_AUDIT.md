# ENCRIX engineering and launch-readiness audit

**Audit date:** 2026-10-31  
**Scope:** Current local working tree and source/migrations only. No production or staging requests, database writes, migrations, billing activation, deployment, or real Twilio calls were performed. The repository had extensive pre-existing uncommitted changes before this audit; all were preserved.

## Integration validation update — 2026-11-06

No persistent database, CRM workflow, provider Test Mode flow, or backup/restore was executed in this follow-up. Docker Desktop is installed but its daemon is unavailable; an unidentified existing PostgreSQL process on port 5432 was left untouched. A separate staging project is configured locally but was not contacted. Razorpay Test Mode credentials were unavailable; the configured Twilio credentials were not verified as belonging to a Test Account. The current counts are 41 migrations and 16 SQL regression files, all unexecuted in this sprint. See [ENCRIX_COMPLETE_AUDIT.md](ENCRIX_COMPLETE_AUDIT.md) for the exact inventory and current release blockers.

## Executive summary

## Execution update — 2026-10-31

This section supersedes stale statements below where they conflict with the current working tree. LOGIN and INVITATION OTP handlers now require durable `email_otps` state and use `complete_email_otp_verification` for atomic row-locked attempt counting and single-use consumption. Missing rows and database/RPC failures fail closed; a signed ticket is not a replacement for durable state. Registration retains its separate ticket-verification and transactional owner-registration path. The OTP SQL migration and regression test are local source artifacts only. Docker Engine was unavailable at the latest recovery attempt, so migration application and independent PostgreSQL concurrency tests have **not** been verified. Do not describe the five-attempt concurrency guarantee as database-verified until the SQL test and parallel-session checks pass on disposable PostgreSQL.

The current customer-facing catalog remains one Business subscription at ₹9,999 INR per year, with no onboarding or registration fee. Checkout is disabled. The environment template omits legacy Starter/Professional Razorpay plan variables and clarifies that Twilio variables do not enable live calling. A controlled release and operations runbook is at `docs/production-release-runbook.md`.

For this execution, the full Vitest run passed **59 files / 766 tests** (exit 0, 125.89 seconds); `npm run build` passed; `npm run lint` exited 0 with existing warnings; `npm audit --offline --audit-level=high` exited 0 and reported zero vulnerabilities from locally cached advisory data only; `git diff --check` exited 0 with line-ending warnings. The suite contains mocked OTP behavior tests, not real database concurrency verification. No production or staging services were accessed, and no database or provider operation was performed.

ENCRIX is an existing React/TypeScript/Vite application with Vercel API routes, Supabase/PostgreSQL tenant data, signed application sessions, OTP auth, Twilio integration, and Razorpay subscription code. The primary customer, lead, team, follow-up, notification, and billing flows have substantial existing implementations. The Twilio server integration, organization credential management and inbound/outbound bridge are now implemented locally, but require migration execution and Twilio Test Account end-to-end verification. `TWILIO_CALLING_ENABLED` defaults to false; keep it false until those gates pass.

The implementation keeps Razorpay checkout disabled. The server catalog has the approved ₹9,999/year Business plan; the public plans API has been corrected in this audit to publish only that plan. No onboarding/registration charge is implemented. Legacy `starter` and `professional` codes remain in schema/source for historical compatibility, but are no longer exposed by the public catalog.

## Status by product flow

| Flow | Status | Evidence and limitations |
|---|---|---|
| Owner registration and OTP | IMPLEMENTED | `send-otp.ts` issues durable registration tickets through `issue_registration_otp_ticket`; `verify-otp.ts` uses `complete_registration_otp_verification` and `create_owner_registration`; migration 310 locks, verifies and consumes tickets transactionally. Local API route rewrites are present. Requires a staging owner-registration E2E run to verify deployed grants and provider delivery. |
| Organization/business details | IMPLEMENTED | Migration 300 adds business billing columns; migration 310 creates owner/profile atomically with pending registration details. API persists/reads billing details in `billingApi.ts`. Not verified against staging during this audit. |
| CSV lead import | IMPLEMENTED | `api/_lib/leads/owner.ts` calls `import_owner_leads`; SQL includes tenant-scoped locking, duplicate handling, distribution/notification/audit code and idempotent import markers. Local tests exist. Staging performance/runtime remains unverified here. |
| Manual lead creation and assignment | IMPLEMENTED | Owner endpoint calls `create_owner_lead`; existing distribution endpoints/services remain. Local verification required; staging behavior is not asserted. |
| Telecaller privacy and tenant reads | IMPLEMENTED | Server lead/API projections and existing RLS migrations enforce organization/assignment scoping and phone masking. Keep verifying every response projection; do not infer complete isolation solely from client UI. |
| Twilio outbound calling | IMPLEMENTED BUT EXTERNAL VERIFICATION REQUIRED | `/api/telephony/call` checks active telecaller, current assignment, E.164 numbers, organization-owned credentials and an idempotency key; a server-side two-leg flow dials the telecaller first and calls the lead only after a signed answer callback. The database migration and provider behavior have not been executed or tested here. |
| Twilio incoming/callback routing | IMPLEMENTED BUT EXTERNAL VERIFICATION REQUIRED | Signed incoming requests resolve a unique organization by its Twilio number, then an exact lead and active verified assignee. No match, ambiguity or unavailable assignee fails closed and is recorded without raw caller phone. Real callback routing and provider signatures require Test Account verification. |
| Twilio status webhooks | IMPLEMENTED | `api/telephony/webhook.ts` validates signatures, correlates persisted calls, stores event receipts and uses conditional monotonic status updates. It currently cannot correlate/update the two separate bridge legs because the bridge is not implemented. |
| Razorpay subscription/billing | IMPLEMENTED LOCALLY | `api/_lib/billingApi.ts` has authenticated owner checkout, provider plan validation, signature verification, webhook HMAC, idempotency, reconciliation, and atomic payment/subscription updates. The only plan is ₹9,999 INR yearly. Mock tests cover the lifecycle; local PostgreSQL and Razorpay Test Mode execution remain outstanding. Runtime checkout requires valid `rzp_test_` credentials, the exact provider plan, and the billing database; live key IDs are rejected. |
| Dashboards, CRM, follow-ups, analytics | IMPLEMENTED | Existing React routes and services cover owner, telecaller and admin flows. This source audit did not certify each role/edge case with browser E2E. |
| Production deployment and remote migrations | BLOCKED | Deliberately not accessed/changed in this audit. Current local source changes and migration state must be reviewed before release. |

## Changes made in this audit

1. `api/_lib/billingApi.ts`: `/api/billing/plans` now publishes only the Business subscription. The database's legacy plan-code constraint is unchanged.
2. `src/test/billing_api.test.ts`: asserts the public catalog contains exactly one plan.
3. `api/_lib/authHandlers/verify-otp.ts`: login profile lookup now returns retryable 503 on database/query failure instead of incorrectly returning “no account found”; genuine PostgREST no-row remains a 404 response.
4. `docs/billing-foundation.md`: marked the older multi-plan proposal as historical and clarified the current ₹9,999/year, one-plan commercial model and test-mode setup.
5. This audit document.

No database files were changed and no SQL was executed.

## Security and reliability findings

- **Tenant boundaries:** lead handlers derive the organization from the authenticated server profile and use organization-scoped RPC arguments. SQL `SECURITY DEFINER` routines have restricted search paths and service-role execution grants in the inspected migrations. Effective remote grants and RLS were not queried in this audit.
- **OTP:** registration ticket issue, attempt counting, verification and registration consumption are durable and RPC-backed. `create_owner_registration` requires a verified, unexpired, unused ticket and commits organization/profile together. Login OTP verification occurs before the profile lookup; database outages now return retryable 503. Validate end-to-end resend/retry semantics in staging before release.
- **OTP database verification blocker:** the previous residual-bypass description above this update is obsolete. The current source uses durable issuance/verification/cancel RPCs and fails closed; the migration adds row-locked atomic attempt updates and single-use consumption. Actual SQL behavior, function grants on the target database, and concurrent requests still require PostgreSQL verification before production.
- **CSV duplicate prevention:** SQL uses an organization-scoped advisory transaction lock for both import and manual creation, plus a write trigger for alternate table writers; it intentionally avoids an unreviewed global uniqueness constraint. International normalization must continue to be checked against the application's normalization rules; SQL digit stripping treats equivalent E.164 digit strings consistently but does not infer country codes.
- **Twilio:** organization Account SID/Auth Token are AES-256-GCM encrypted with organization-bound AAD; only the public Twilio number is stored separately for number resolution. Configuration API access is active-owner-only and responses contain only masked number metadata. The API call path never returns lead phone or provider credentials. Outbound/inbound bridge implementation is gated off by default, and its SQL/provider behavior remains unverified. Legacy browser provider code must remain inaccessible in live mode.
- **Billing:** API price and cadence come from server configuration and Razorpay provider plan verification. Checkout is disabled in `api/_lib/billingPlans.ts`; do not turn it on as part of this audit. Webhook and payment state logic requires staging replay/out-of-order verification.
- **Service role:** API code uses a Supabase service client, which bypasses RLS. Therefore route-level auth/role/organization checks remain essential. Do not rely on RLS alone for server APIs.
- **Environment hygiene:** names were inspected without printing values. Never place service-role, OTP/session, Razorpay secret, or Twilio auth secrets in any `VITE_` variable.

## Environment variable names observed

Client-visible configuration names: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV`, `VITE_ENABLE_DEMO_SANDBOX`, `VITE_USE_LIVE_API`.

Server Supabase/auth: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (code also accepts legacy `SUPABASE_SERVICE_KEY`), `SESSION_SERVER_SECRET`, `OTP_SERVER_SECRET`.

OTP email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`; optional fallback `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`.

Twilio: `TWILIO_CREDENTIAL_ENCRYPTION_KEYS`, `TWILIO_CREDENTIALS_ACTIVE_KEY_ID`, `TWILIO_PUBLIC_WEBHOOK_BASE_URL`, and `TWILIO_CALLING_ENABLED`. Each organization supplies its own Account SID, Auth Token and phone number through the owner settings API; provider values are not committed or returned to the browser.

Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_BUSINESS`, `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT`. Business Test Mode checkout is available only after server-side credential, exact plan, and database checks pass; live Razorpay key IDs are rejected.

Operations: `CRON_SECRET`, `ENABLE_FOLLOWUP_EMAIL_REMINDERS`, `SUBSCRIPTION_ENFORCEMENT_ENABLED`, `TELEPHONY_PROVIDER`. Environment files were inspected for names only. Presence/value correctness and Vercel environment scopes were not verified.

## Verification and test plan

Final local verification on the current source state:

- Focused auth/billing suite: `npx vitest run src/test/phase25_login_otp_ticket_resilience.test.ts src/test/billing_api.test.ts --maxWorkers=2` — **2 files passed, 35 tests passed, exit 0**.
- Latest full suite: `npm test -- --maxWorkers=2 --reporter=dot` — **59 files passed, 766 tests passed, exit 0** (125.89 seconds).
- Latest `npm run lint` — **exit 0**, with existing repository warnings (unused imports/variables, hook dependencies, React purity/immutability).
- Latest `npm run build` — **exit 0**; Vite emitted the existing >500 kB chunk warning.
- Latest `npm audit --offline --audit-level=high` — **exit 0**, zero cached advisories; this is not a current registry audit.
- Latest `git diff --check` — **exit 0**; Git reported normal LF-to-CRLF working-copy warnings.

The suite cannot establish remote migration grants, provider callbacks, email delivery, Razorpay webhook delivery, Twilio caller-ID eligibility, or cross-tenant runtime behavior.

Staging E2E with test data is **not run**. It requires staging database writes (owner registration, organizations, leads, calls/payments and cleanup). The project instructions require approval before remote database changes. No cleanup or staging writes were attempted.

## Required staging validation before production review

1. Confirm target is staging project `vhqqczgomrznisvbhpvf` and capture a fresh schema/migration-history backup. Never point these instructions at production project `wrzoqxesffbfirjgotbr`.
2. Have an operator verify migration history and schema against all repository migrations, particularly `20261030000000`, `20261030120000`, and `20261031000000`. Do not rerun `db push`, repair, or reset based only on a migration list.
3. Read-only inspect grants, RLS, triggers, RPC definitions/search paths and indexes. Run SQL regression scripts in an isolated staging transaction/approved test session only after confirming they roll back.
4. With explicit approval for staging writes, run owner OTP registration/resend/expiry/replay tests; CSV import, retry and reload tests; assignment and phone privacy tests; Razorpay Test Mode lifecycle and webhook replay tests. Keep checkout disabled unless separately approved for a tightly controlled test.
5. Apply and review the organization Twilio migration on disposable PostgreSQL, then verify organization separation, outbound bridge idempotency, inbound fail-closed routing and signed callbacks against Twilio Test Accounts. Keep `TWILIO_CALLING_ENABLED=false` until the evidence is reviewed.
6. Run UI/API E2E with controlled test identities and delete only test data using a reviewed cleanup plan; preserve all customer records.
7. Only after staging sign-off, prepare production runbook, verified env-name/value checklist without secrets in source, approved migration plan, backup/rollback steps and deployment approval. No deployment is authorized by this audit.

## Release recommendation

**Not production-ready yet.** The explicit blockers are incomplete Twilio outbound/incoming call flows, unverified staging effective permissions and runtime behavior, and missing controlled staging E2E. Checkout is still disabled. The updated public catalog now reflects exactly one subscription at ₹9,999/year; no payment has been initiated.
