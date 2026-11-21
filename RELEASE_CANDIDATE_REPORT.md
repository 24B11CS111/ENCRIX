# ENCRIX Release Candidate 1.0 Assessment

**Assessment date:** 2026-11-09
**Decision: NO-GO for Production migration/deployment; prior staging acceptance remains NO-GO**

## Main Production preflight — read-only follow-up (2026-11-09)

This section records a later read-only inspection of the intended main ENCRIX project. It supersedes earlier statements in this report that Production had not been inspected. No database changes, migrations, Vercel configuration changes, or deployment were performed.

### Confirmed project and migration-history metadata

- Supabase project: `ENCRIX`, reference `wrzoqxesffbfirjgotbr`, URL `https://wrzoqxesffbfirjgotbr.supabase.co`, region `eu-west-1`, PostgreSQL `17.11`, status active/healthy.
- The repository's Supabase CLI link points to `vhqqczgomrznisvbhpvf` (the separate `ENCRIX-Staging` project), not the main project. All Production history inspection used an explicit main project reference; no implicit linked-project command was used for Production.
- Production migration history contains only `20261001000000` and `20261001000001`. Those are **recorded**; the other 39 repository migrations are **not recorded**. This does not establish whether their objects/effects are absent, partially present, or conflicting.
- Direct Production catalog queries for tables, constraints/data compatibility, RLS policies, functions/owners/grants, and extensions were blocked because the Supabase CLI temporary database role failed password authentication. No database password was read, printed, requested in chat, or changed. The two immutable audit triggers reported by the successful read-only check are the only Production trigger detail verified.
- Backup/PITR restore readiness and existing customer-data compatibility remain unknown. No data rows were queried.

### Vercel and Auth metadata

- Vercel project discovered by name: `encrix`; Production domain `https://encrix.vercel.app`; framework Vite; root `.`; Node `24.x`; build command `npm run build` / `vite build`; Vercel output-directory setting reported as unset (`None`; Vite's normal output is `dist`). `.vercel/project.json` is absent, so local project linkage is not configured in this checkout.
- Existing [vercel.json](./vercel.json) contains API rewrites for auth, leads, billing, reminders and monitor routes, plus SPA fallback and security headers. This was inspected, not changed.
- Supabase Auth's read-only public settings response showed email auth enabled, sign-up enabled and email auto-confirm disabled. It did not provide the Site URL or redirect allow-list; those remain unverified.
- Vercel environment variable names were retrieved without values. The observed list includes both `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, OTP/session, email, Razorpay, Twilio and cron variables. Legacy `NEXT_PUBLIC_*` Supabase names and `SUBSCRIPTION_ENFORCEMENT_ENABLED` are also present. The application-declared `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT`, `TWILIO_CREDENTIAL_ENCRYPTION_KEYS`, `TWILIO_CREDENTIALS_ACTIVE_KEY_ID`, and `TWILIO_PUBLIC_WEBHOOK_BASE_URL` were not found in the Production name listing. Presence/validity of all values is unverified; none were displayed or changed.

### Application and isolated-database checks

- `npm test`: **90 test files, 1,008 tests passed**.
- `npm run build`: exit 0; includes TypeScript project checks and Vite production build.
- `npm run lint`: exit 0, **140 warnings, 0 errors**.
- Isolated PostgreSQL 17 validation: **41/41 repository migrations applied; 16/16 SQL regression scripts passed**. This validates only the disposable local database, not Production.
- No production security/catalog checks or Production end-to-end flows could be completed without catalog access. The earlier isolated catalog checks and rollback-only two-organization fixtures are local evidence only.

### Production readiness and required next steps

**NO-GO for Production migrations and deployment.** The migration ledger is incomplete relative to the repository, actual catalog/data state cannot be compared, and backup/restore readiness, auth redirects, and some Vercel runtime names remain unverified. Do not infer the 39 unrecorded migrations are safely absent or replayable.

1. An authorized operator must arrange secure, read-only database access locally (do not send a password in chat) or run the documented aggregate/catalog-only queries in the confirmed Supabase SQL Editor. Reconcile every object and effect before choosing migrations.
2. Verify restorable backup/PITR evidence and obtain an explicit recovery owner/window before any write.
3. Verify auth Site URL/redirect allow-list, Vercel Production variable names/scopes/validity, and the missing application-declared names without exposing values. Resolve obsolete/duplicate names in a separate approved change.
4. Review the exact ordered migration plan in [ENCRIX_DATABASE_MIGRATION_PLAN.md](./docs/ENCRIX_DATABASE_MIGRATION_PLAN.md), compare each script with the live catalog, check data and conflict preconditions, and obtain separate approval for each database operation.
5. Only after the database and application gates pass, seek separate explicit approval for Vercel Production variable changes and deployment. No deployment, remote migration, environment change, payment, refund, phone call, or email was initiated in this preflight.

## Executive summary

The current working tree's prior application checks are recorded below. Local validation applied all 41 ordered repository migrations and passed all 16 SQL regression scripts on an isolated Supabase-compatible PostgreSQL 17 database. This follow-up also passed 322 mock-based application tests across 21 test files. Catalog checks found RLS enabled on all 35 public tables, no API-readable public table without RLS, no public SECURITY DEFINER function missing a configured search path, no disabled user triggers, and no unvalidated public constraints.

This is not a staging or production-readiness sign-off. No verified hosted staging target was available locally: there is no `.vercel/project.json`, and the local Supabase project-reference marker was not inspected or used. Local `.env.local`, `.env.staging`, and `.env.production` files exist, but their values were not read or used. No staging deployment or browser-based E2E run was performed. Registration and recovery emails, Razorpay Test Mode webhooks, Twilio callbacks/calls, signed recording URLs, and deployed tenant isolation therefore remain unverified. No Production database, deployment, payment, refund, or phone call was accessed or initiated.

## Local infrastructure and database validation (2026-11-09)

- Docker Desktop was installed, but its Linux engine was initially stopped. It was started locally and `docker info` confirmed the engine is available.
- The native `postgresql-x64-17` Windows service was already running on port 5432. It was not stopped, modified, or used.
- Existing Supabase containers included a project named `ENCRIX` already bound to port 54322. It was not reset, connected to, or modified.
- Validation used a separate temporary Supabase project (`encrix-validation-8fec8f08f494`) with PostgreSQL 17 on port 56422 and migrations/tests copied into a temporary work directory. Its database-only Docker stack is separate from the existing ENCRIX containers.
- `supabase start` applied 41 migrations in timestamp order. `supabase migration list --local` recorded all 41 as applied locally.
- SQL regression result: **16 passed, 0 failed**. Fixtures were in rollback-only transactions.

### Catalog checks

| Check | Result |
|---|---:|
| Public tables with RLS enabled | 35/35 |
| API-readable public tables without RLS | 0 |
| Public functions / SECURITY DEFINER functions | 64 / 62 |
| SECURITY DEFINER functions without a configured search path | 0 |
| User triggers / disabled user triggers | 8 / 0 |
| Public constraints / unvalidated constraints | 198 / 0 |

Two-organization isolation was exercised by the Phase 23.8 and Phase 24.7 SQL tests. Tenant A could not read Tenant B's records through the tested authenticated paths; the telecaller server RPC returned no cross-organization rows and rejected cross-organization updates. All synthetic fixtures rolled back.

### Local application test run (2026-11-09)

With provider/database credentials removed from the test process and provider fetches mocked, **21 test files passed; 322 tests passed; 0 failed**. These are local unit/component/API contract tests, not staging E2E or live-provider evidence.

First run (14 files):

- `billing_api.test.ts`
- `billing_policy_workflows.test.ts`
- `razorpay_lifecycle_api.test.ts`
- `durable_email_otp_attempts.test.ts`
- `phase25_otp_registration_resilience.test.ts`
- `phase25_login_otp_ticket_resilience.test.ts`
- `phase28_telecaller_invitation_email_otp.test.ts`
- `phase29_invitation_management_api.test.ts`
- `dashboard_workflows.test.tsx`
- `lead_workflow.test.ts`
- `phase24_7_server_telecaller_leads.test.ts`
- `security_isolation.test.ts`
- `telephony_webhook.test.ts`
- `followup_email_outbox.test.ts`

Second run (7 files):

- `phase16_realtime_auth_crm.test.ts`
- `owner_onboarding_flow.test.tsx`
- `phase27_telecaller_invitation_acceptance.test.tsx`
- `paid_entitlement_180000_workflow.test.ts`
- `phase23_2_secure_recording_pipeline.test.ts`
- `security_hardening_adversarial.test.ts`
- `phase14_production_security.test.ts`

Coverage includes mocked OTP/login/logout and invitation flows, lead/dashboard workflows, webhook signature/idempotency contracts, admin refund review/partial-refund policy, cancellation-at-period-end, entitlement decisions, follow-up behavior, telephony callback/recording authorization, and security/isolation checks. These results do not prove external email delivery, a provider-created subscription, an accepted Razorpay webhook, or a real Twilio signed callback.

### Exact migration inventory

All entries below were applied successfully in this order:

1. `20261001000000_init_leadvault.sql`
2. `20261001000001_security_hardening.sql`
3. `20261006000000_production_telephony_recordings.sql`
4. `20261007000000_otp_authentication_and_onboarding.sql`
5. `20261008000000_email_otp_authentication.sql`
6. `20261012000000_phase17_realtime_crm_telephony.sql`
7. `20261013000000_phase18_secure_student_details_zero_phone.sql`
8. `20261014000000_phase20_smart_lead_distribution.sql`
9. `20261015000000_phase21_smart_follow_up_engine.sql`
10. `20261018000000_phase22_security_critical_remediation.sql`
11. `20261019000000_phase22_phone_exposure_remediation.sql`
12. `20261020000000_phase23_followup_reminder_concurrency.sql`
13. `20261021000000_phase23_7_production_blocker_remediation.sql`
14. `20261022000000_phase23_8_active_profile_rls.sql`
15. `20261023000000_billing_foundation.sql`
16. `20261023120000_secure_caller_enrollment_bridge_persistence.sql`
17. `20261024100000_phase24_1_security_remediation.sql`
18. `20261024120000_phase24_3_secure_telecaller_lead_access.sql`
19. `20261024130000_phase24_7_server_telecaller_leads.sql`
20. `20261027000000_phase32_realtime_publications.sql`
21. `20261028000000_phase33_realtime_notifications.sql`
22. `20261030000000_owner_business_billing_details.sql`
23. `20261030120000_owner_csv_import_persistence.sql`
24. `20261031000000_onboarding_billing_integrity.sql`
25. `20261031120000_sanitized_lead_refresh_signals.sql`
26. `20261031130000_public_leads_privilege_hardening.sql`
27. `20261031140000_security_definer_search_path_hardening.sql`
28. `20261031150000_durable_email_otp_attempts.sql`
29. `20261031160000_organization_twilio_calling.sql`
30. `20261031170000_razorpay_atomic_subscription_lifecycle.sql`
31. `20261031180000_paid_subscription_entitlement_gate.sql`
32. `20261101090000_followup_email_outbox.sql`
33. `20261101100000_unique_pending_invitations.sql`
34. `20261104120000_founding_pilot_entitlements.sql`
35. `20261105130000_razorpay_failed_refund_transition.sql`
36. `20261105140000_paid_entitlement_provider_identity.sql`
37. `20261105150000_razorpay_active_subscription_required.sql`
38. `20261105160000_registration_otp_send_rate_limit.sql`
39. `20261105170000_billing_refund_cancellation_workflows.sql`
40. `20261106100000_admin_refund_management.sql`
41. `20261107100000_persistent_server_session_revocation.sql`

### Exact SQL regression results

Each listed script passed:

1. `durable_email_otp_attempts.test.sql`
2. `followup_email_outbox.test.sql`
3. `founding_pilot_entitlements.test.sql`
4. `lead_refresh_signals.test.sql`
5. `onboarding_billing_integrity.test.sql`
6. `organization_twilio_calling.test.sql`
7. `owner_csv_import_persistence.test.sql`
8. `paid_subscription_entitlement_gate.test.sql`
9. `pending_invitation_uniqueness.test.sql`
10. `persistent_server_session_revocation.test.sql`
11. `phase23_8_inactive_profile_rls.test.sql`
12. `phase24_3_telecaller_lead_access.test.sql`
13. `phase24_7_server_telecaller_leads.test.sql`
14. `public_leads_privilege_hardening.test.sql`
15. `razorpay_atomic_subscription_lifecycle.test.sql`
16. `security_definer_search_path_hardening.test.sql`

## Release inventory

The assessment is against a pre-existing, extensively modified working tree, not a clean commit. Existing changes were preserved. No files were staged, committed, discarded, or reset. Only this report and the staging integration checklist were updated for this task.

## Validation summary

| Area | Result |
|---|---|
| Unit tests | Prior sprint report: `npm test` — 90 files, 1,008 tests passed; not rerun in this staging preparation |
| Targeted local app tests | This run: 21 files, 322 tests passed; provider behavior mocked; not staging E2E |
| TypeScript | Prior sprint report: frontend and API checks passed; not rerun in this staging preparation |
| Lint | Prior sprint report: `npm run lint` exited 0; 187 warnings, 0 lint errors; not rerun in this staging preparation |
| Database | This run: 41/41 migrations applied; 16/16 SQL regression files passed on isolated Supabase-compatible PostgreSQL 17 |
| RLS/catalog | This run: 35/35 public tables have RLS; 0 API-readable public tables without RLS; 0 SECURITY DEFINER functions missing a configured search path |
| Auth/CRM E2E | Not run against a deployed staging environment |
| Razorpay/Twilio | No provider checkout, payment, refund, email send, call, or callback was initiated |
| Staging | Not deployed; no browser E2E evidence; no external configuration changed |

See the [staging integration checklist](./docs/ENCRIX_STAGING_INTEGRATION_CHECKLIST.md) for repeatable local database setup, staging-only configuration, and controlled E2E scenarios.

## Staging acceptance and release-blocking items

**NO-GO for controlled staging acceptance.** Local PostgreSQL and mocked application contracts pass, but there is no verified staging project/domain/configuration and no browser or provider E2E evidence. Do not treat this report as permission to deploy, configure external providers, or run remote migrations.

1. Provision and independently verify an isolated staging deployment, database, and provider test credentials without using Production values.
2. Run the owner, telecaller, admin refund-review, and billing lifecycle browser E2E flows in staging with controlled synthetic identities and capture redacted evidence.
3. Explicitly approve any staging deployment, staging-only environment changes, or future staging migration window before those actions. No Production scope is authorized.
4. Verify OTP/email and signed webhook configuration using controlled test mailboxes and provider Test Mode. Do not initiate real payments, refunds, or Twilio calls.
5. Review the low-priority database ACL observation from the prior audit and decide whether to revoke unnecessary execution grants from the trigger-only audit function in a new, reviewed migration.
6. Review and prioritize the existing 187 lint warnings.

The Business catalog remains ₹9,999 INR annually and checkout is disabled in the current code. The ₹10,000 onboarding fee remains deferred. The isolated local database stack is not a staging deployment. No Production operation is approved by this report. Stop at staging validation and wait for explicit approval before any Production action.
