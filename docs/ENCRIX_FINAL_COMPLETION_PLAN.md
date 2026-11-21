# ENCRIX Final Production Completion Plan

**Prepared:** 2026-11-03
**Decision:** **NO-GO for production launch**
**Scope:** Existing ENCRIX application, repository migrations, supplied production facts, and local automated verification. No production connection, SQL execution, migration, provider request, environment change, or deployment was performed for this plan.

## Executive summary

ENCRIX has implemented owner registration, OTP authentication, tenant-scoped CRM, lead import/assignment, sanitized Realtime refresh, invitations, Twilio integration, Razorpay Test Mode billing, entitlement checks, and follow-up processing. Current local code passes the recorded application checks below. Those tests do not prove production schema, grants, secrets, provider setup, webhooks, or real end-to-end behavior.

Production launch is blocked by the reported login OTP failure, missing billing tables and entitlement RPC, incomplete reconciliation of 31 unrecorded migrations, unresolved broad default privileges, unverified production configuration, and lack of live Razorpay support in the current code. Twilio calling must remain disabled until the database, encryption key ring, callback signature validation, and controlled provider tests pass. Vercel Hobby remains the target; the local API entrypoint count is at the 12-function cap and the deployed count still needs verification.

No application source change was justified by this pass: the current local implementation already has broad regression coverage and passes the local suite/build/type checks. Production failures cannot be safely repaired by guessing at SQL or configuration. The only new artifact is this prioritized execution plan.

## Evidence and migration classification rules

- Production facts below are only facts supplied from the operator's SQL Editor investigation or runtime UI. No production session was opened here.
- A migration-history row proves that a version is recorded; it does **not** prove its effects are intact.
- An absent history row does **not** prove the migration's SQL effects are absent.
- `UNKNOWN` means complete catalog evidence was not supplied. It must not be replayed or baselined without a source-to-catalog comparison.
- For a migration with a confirmed missing principal object but unreported ancillary objects, the table says so explicitly; do not interpret that as permission for blind replay.

## Prioritized blockers and implementation plan

| Priority | Blocker / evidence | Local source and behavior | Required action and safe verification | Production SQL? |
|---|---|---|---|---|
| P1 | **Owner and telecaller OTP login fails** with “Authentication verification could not be prepared.” Production `email_otps` base table exists; durable `ticket_id`, `verified_at`, three durable ticket RPCs and ticket index were reported missing. The purpose check is confirmed as validated and semantically the migration 080000 LOGIN/REGISTER/INVITATION check. | `api/_lib/authHandlers/send-otp.ts` calls `issue_email_otp_ticket`; the durable objects are defined by `supabase/migrations/20261031150000_durable_email_otp_attempts.sql`. The exact API error only establishes that ticket preparation failed; it does not identify whether the production cause was missing RPC/schema-cache/privilege/connectivity/configuration. | First retrieve the safe Vercel runtime event fields (stage, error code/status, timestamp/request ID only). Confirm the SQL Editor project reference, then run the OTP read-only preflight and all checks in this document. Take/verify a restorable backup. Only after every repair guard passes, review and separately authorize `supabase/tests/repair_production_durable_email_otp.sql`; this forward repair does not insert migration history. Verify columns, unique partial index, exact function metadata and service-role-only execute grants, then test OTP lifecycle and independent-session concurrency. | **Yes**, only after preflight, backup, project identity, and explicit operator approval. |
| P1 | **Paid billing persistence is unavailable.** Production reports `organization_subscriptions`, `billing_payments`, `billing_webhook_events`, and `organization_has_active_paid_entitlement(uuid)` absent. | Billing routes/repository: `api/_lib/billingApi.ts`, `api/_lib/billingRepository.ts`; centralized gate: `api/_lib/paidEntitlement.ts`. Gate failures are fail-closed. Source plan is ₹9,999/year, INR, no onboarding fee (`api/_lib/billingPlans.ts`). | Reconcile all prerequisites/data/ACLs first. Candidate dependency order is migration 230000 → 300000 → 310000 → 311700 → 311800, but only after confirming the base org/profile/registration schema, every object each migration touches, data-check compatibility, actual migration executor/default ACLs, and per-version history. Run PostgreSQL SQL regression tests and billing/entitlement integration tests after each reviewed change. Do not grant paid access or enable checkout to work around missing DB state. | **Yes.** Apply only individually reviewed migrations/repairs, never broad `db push`. |
| P1 | **Production migration reconciliation is incomplete.** Only versions 010000 and 010001 are reported recorded; 31 repository migrations are unrecorded. Most production definitions have no full result artifact here. | Source expectations and evidence boundary are captured in `docs/production-schema-reconciliation.md` and the classification table below. | Run the nine standalone read-only SQL Editor diagnostics in the specified order and save complete output. Compare definitions, not names alone. For each version decide apply, verified-in-substance baseline, conflict repair, or unknown. Use an approved restorable backup/PITR point. Do not bulk push, bulk baseline, or repair history before object-by-object proof. | **Read-only queries first; later, reviewed version-specific SQL only.** |
| P1 | **Broad production default ACLs were reported.** Exact affected roles/object types and the effective migration executor are not established by available production output. | Migration 130000 narrows `postgres` public-schema defaults only. It does not prove or correct defaults for `supabase_admin` or another actual object-creator. | Retrieve stored global and per-schema default ACLs for `postgres`, `supabase_admin`, and the role proven by deployment/migration logs to create objects; retrieve role memberships and effective grants for sensitive tables/functions. Prepare role-scoped least-privilege SQL only after identifying the creator and dependencies. Recheck future-object defaults and current effective ACLs. | **Read-only SQL, then likely reviewed ACL SQL.** |
| P1 | **Production tenant isolation / raw lead exposure is not fully verified.** Prior broad `public.leads` grants and raw Realtime exposure were reported; complete current production ACL/policy/publication results were not supplied. | Local architecture uses sanitized telecaller views/server RPCs and `lead_refresh_signals`; migrations 311200 and 311300 alter publication/grants. | Run diagnostics for stored/effective table and column grants, policies, SECURITY DEFINER owner/search path/execute grants, triggers, and exact Realtime publication columns. Verify telecaller direct REST and Realtime cannot expose phone/email; verify owner/admin refresh and tenant isolation in staging using test tenants. | **Read-only SQL first; migration only after reconciliation.** |
| P1 | **Live Razorpay is not supported by current code.** Local billing security requires Test Mode key IDs; production readiness and webhook behavior remain unverified. | `api/_lib/billingSecurity.ts`, `api/_lib/billingApi.ts`, `api/_lib/billingPlans.ts`; database lifecycle is in migration 311700. | Complete Razorpay Test Mode E2E against a validated database. Separately implement/review an explicit live-mode policy and live plan/webhook configuration before charging customers. Validate signature, amount/currency, subscription/org binding, idempotency, duplicate/out-of-order events, refunds, renewal and expiry. Never simply substitute live credentials into Test-Mode-only code. | **No SQL for provider setup; billing SQL state must first be reviewed/applied.** |
| P1 | **OTP send abuse protection is per email, not a demonstrated server/IP abuse limit.** | `issue_email_otp_ticket` applies durable per-email cooldown/rate limits. `api/_lib/authHandlers/send-otp.ts` accepts public OTP requests; browser-side throttling is not authoritative. | Before broad launch, design an edge/server rate limit that uses a trusted source IP and privacy-preserving normalized-email key, with distributed enforcement and safe generic responses. Test forwarding-header spoofing and multi-instance bypass. Do not replace or weaken the durable per-email DB limits. No new in-memory-only limiter should be treated as production protection. | **Probably a new durable/edge dependency; not prepared until design and deployment facility are selected.** |
| P1 | **Production env scopes and project identity are unverified.** No authorized Vercel Production scope inventory or production secrets were accessed. | Required names are documented in `.env.example` and `.env.staging.example`; server-only access is in `api/_lib/supabaseServer.ts`. | Authorized operator verifies names/presence and project references in Vercel Production without sharing values: Supabase URL/service key, OTP/session secrets, Resend key/from, Razorpay mode/keys/plan/webhook secret, Twilio encryption key ring and feature flag, cron secret, app origin, optional email reminder flag. Ensure no secrets use `VITE_` names. | **No SQL; Vercel dashboard review required.** |
| P1 | **Automated follow-up timing is not provided by Vercel Hobby configuration.** The endpoint exists, but `vercel.json` has no cron entry; the reminder processor handles a 15-minute window. | `api/cron/follow-up-reminders.ts`, `api/_lib/reminderProcessor.ts`, `supabase/migrations/20261101090000_followup_email_outbox.sql`. Vercel Hobby's schedule cannot provide the required frequent cadence. | Select an external scheduler capable of the needed cadence and authorize only with `CRON_SECRET`, or explicitly defer automated reminders. Test duplicate invocation/outbox claiming with independent sessions and controlled inboxes. Do not claim reminders are operational without a scheduler. | **No schema change if outbox migration is already reconciled; scheduler configuration is required.** |
| P1 | **Twilio calls/recordings lack production E2E proof.** | Organization-scoped encrypted credentials and call/webhook code exist. `TWILIO_CALLING_ENABLED` must remain false until validated. Recording flow is not certified as provider-operational. | Verify 160000 and dependencies, key rotation/config presence, organization-to-number mapping, exact webhook URLs, Twilio signature validation, inbound no-match/ambiguous/offline fail-closed behavior, callback ordering and recording storage/callback behavior in a controlled test account. Use a dedicated approved test number; never call customers during tests. | **Twilio schema migration only after production reconciliation; no provider action in this plan.** |
| P2 | **Vercel Hobby cap is exactly saturated locally.** | Local configuration consolidates routes and `docs/ENCRIX_FINAL_PRODUCTION_READINESS.md` records 12 eligible API entrypoints. | Verify actual deployment function inventory is exactly ≤12 and smoke-test all public URLs, methods, rewrites/query preservation, auth/webhook raw-body behavior and timeouts on a protected preview. No Pro upgrade is assumed. | No. |
| P2 | **Production deployment reachability/log evidence is absent.** Runtime log detail for the OTP error and project deployment settings are not available in repository evidence. | Safe logger emits stage/code/status from `send-otp.ts`; no connected production log source was used. | Operator retrieves only safe log fields; verify deployment protection/public route accessibility and active commit through Vercel console. Do not share request bodies, tokens, OTPs, or PII. | No. |

## Production migration reconciliation: all 33 repository versions

The versions below are recorded/unrecorded according to the supplied history summary, not independently queried in this task. For recorded versions, their effects remain unverified unless explicitly stated. `UNKNOWN` is intentionally used rather than inferring absence from missing history.

| Version | Migration | History | Effect classification from available production evidence |
|---|---|---|---|
| 20261001000000 | `20261001000000_init_leadvault.sql` | Recorded | **Unknown** — record reported; base table/function/policy definitions not fully compared. |
| 20261001000001 | `20261001000001_security_hardening.sql` | Recorded | **Unknown** — record reported; audit/view/function/grants not fully compared. |
| 20261006000000 | `20261006000000_production_telephony_recordings.sql` | Unrecorded | **Unknown**. |
| 20261007000000 | `20261007000000_otp_authentication_and_onboarding.sql` | Unrecorded | **Unknown**. |
| 20261008000000 | `20261008000000_email_otp_authentication.sql` | Unrecorded | **Unknown** — base `email_otps` table, 9 columns, `id` PK, uuid-ossp default and exact validated purpose check are evidenced; full migration effects (profile columns/indexes, related constraints/policies) are not all verified. |
| 20261012000000 | `20261012000000_phase17_realtime_crm_telephony.sql` | Unrecorded | **Unknown**. |
| 20261013000000 | `20261013000000_phase18_secure_student_details_zero_phone.sql` | Unrecorded | **Unknown**. |
| 20261014000000 | `20261014000000_phase20_smart_lead_distribution.sql` | Unrecorded | **Unknown**. |
| 20261015000000 | `20261015000000_phase21_smart_follow_up_engine.sql` | Unrecorded | **Unknown**. |
| 20261018000000 | `20261018000000_phase22_security_critical_remediation.sql` | Unrecorded | **Unknown**. |
| 20261019000000 | `20261019000000_phase22_phone_exposure_remediation.sql` | Unrecorded | **Unknown**. |
| 20261020000000 | `20261020000000_phase23_followup_reminder_concurrency.sql` | Unrecorded | **Unknown**. |
| 20261021000000 | `20261021000000_phase23_7_production_blocker_remediation.sql` | Unrecorded | **Unknown**. |
| 20261022000000 | `20261022000000_phase23_8_active_profile_rls.sql` | Unrecorded | **Unknown**. |
| 20261023000000 | `20261023000000_billing_foundation.sql` | Unrecorded | **Confirmed missing principal effects** — `organization_subscriptions`, `billing_payments`, and `billing_webhook_events` were reported absent. Other index/policy/ACL state must still be inspected; do not replay blindly. |
| 20261023120000 | `20261023120000_secure_caller_enrollment_bridge_persistence.sql` | Unrecorded | **Unknown**. |
| 20261024100000 | `20261024100000_phase24_1_security_remediation.sql` | Unrecorded | **Unknown**. |
| 20261024120000 | `20261024120000_phase24_3_secure_telecaller_lead_access.sql` | Unrecorded | **Unknown**. |
| 20261024130000 | `20261024130000_phase24_7_server_telecaller_leads.sql` | Unrecorded | **Unknown**. |
| 20261027000000 | `20261027000000_phase32_realtime_publications.sql` | Unrecorded | **Unknown**. |
| 20261028000000 | `20261028000000_phase33_realtime_notifications.sql` | Unrecorded | **Unknown**. |
| 20261030000000 | `20261030000000_owner_business_billing_details.sql` | Unrecorded | **Unknown**. |
| 20261030120000 | `20261030120000_owner_csv_import_persistence.sql` | Unrecorded | **Unknown**. |
| 20261031000000 | `20261031000000_onboarding_billing_integrity.sql` | Unrecorded | **Unknown** — it also adds billing constraints and replaces registration/payment security logic; some billing targets are reported absent, while registration effects have no complete production result. |
| 20261031120000 | `20261031120000_sanitized_lead_refresh_signals.sql` | Unrecorded | **Unknown**. |
| 20261031130000 | `20261031130000_public_leads_privilege_hardening.sql` | Unrecorded | **Unknown** — production broad default privileges were reported; exact current ACL/default ACL state and effects remain to be reconciled. |
| 20261031140000 | `20261031140000_security_definer_search_path_hardening.sql` | Unrecorded | **Unknown**. |
| 20261031150000 | `20261031150000_durable_email_otp_attempts.sql` | Unrecorded | **Confirmed missing migration-specific effects** — `ticket_id`, `verified_at`, `email_otps_ticket_id_uidx`, and all three durable OTP RPCs were reported absent. Base table/purpose prerequisites are present. Version should not be recorded until the approved repair/migration effects are complete and compared. |
| 20261031160000 | `20261031160000_organization_twilio_calling.sql` | Unrecorded | **Unknown**. |
| 20261031170000 | `20261031170000_razorpay_atomic_subscription_lifecycle.sql` | Unrecorded | **Unknown** — depends on billing foundation and onboarding integrity; missing billing tables block safe application until prerequisites are resolved. |
| 20261031180000 | `20261031180000_paid_subscription_entitlement_gate.sql` | Unrecorded | **Confirmed missing principal effect** — `organization_has_active_paid_entitlement(uuid)` was reported absent; the underlying billing tables are also reported absent. Other object state remains to be reconciled. |
| 20261101090000 | `20261101090000_followup_email_outbox.sql` | Unrecorded | **Unknown**. |
| 20261101100000 | `20261101100000_unique_pending_invitations.sql` | Unrecorded | **Unknown**. |

## Application review and launch acceptance

Local implementation surface inspected via existing source/tests and the current readiness audit:

- **Auth/registration:** `_lib/authHandlers` contains OTP issue/verify, session, registration, recovery and invitation handlers. `api/_lib/otpServer.ts` supplies HMAC/session protections; database-backed durable OTP calls require the production migration effects above. Production login cannot be declared fixed until a controlled production error is diagnosed and a PostgreSQL lifecycle/concurrency test passes.
- **Organization onboarding:** transactional registration and business-details persistence depend on migrations 300000/310000 and remain unverified in production.
- **Razorpay:** server routes validate provider-side amount, INR, signatures and organization/subscription association; atomic activation depends on 230000/310000/311700. Current key validation is Test-Mode-only. No customer payment should be initiated until the DB is ready and the mode policy is resolved.
- **Entitlements:** `api/_lib/paidEntitlement.ts` is fail-closed and protects paid routes. Confirmed missing database authority means paid CRM should remain unavailable, not bypassed.
- **Leads/CRM:** owner and telecaller routes, CSV persistence, distribution and sanitized Realtime refresh are in source. Production RPCs, ACLs, RLS and publication are not verified. No raw phone/email Realtime payload is acceptable.
- **Invitations/email:** invitation, recovery and Resend-backed delivery have tests, but sender-domain, templates, rate limits and production secret presence remain unverified.
- **Twilio:** organization credential encryption and webhook/call architecture are present; do not enable calls before per-tenant credential, signature, routing, recording and callback tests with a dedicated provider test account.
- **Follow-ups:** bounded outbox processing is implemented, but migration 190000 and an adequate recurring scheduler are unverified. Vercel Hobby cron is not suitable for a frequent 15-minute reminder loop; use an approved external scheduler or defer the automated email reminder feature.
- **Vercel Hobby:** local consolidation retains the public routes and targets 12 function entrypoints. Confirm deployed inventory from the actual build/deployment; this repo-level count does not prove the production deployment count.

### Ordered operator sequence

1. **Read-only production evidence:** confirm the selected project reference in SQL Editor and Vercel; capture safe OTP runtime error fields; execute the nine standalone diagnostics in this order: `diagnose_production_identity_history.sql`, `diagnose_production_primary_artifacts.sql`, `diagnose_production_relations_columns.sql`, `diagnose_production_indexes_constraints.sql`, `diagnose_production_functions.sql`, `diagnose_production_triggers_policies.sql`, `diagnose_production_acls.sql`, `diagnose_production_realtime.sql`, `diagnose_production_data_preflight.sql`. Preserve all complete outputs.
2. **OTP repair readiness:** run `preflight_production_durable_email_otp.sql`; all checks must pass except the documented identity item, which the operator confirms in the SQL Editor. Verify backup/restore. Review and separately authorize `repair_production_durable_email_otp.sql`. This script is a narrowly scoped forward repair and deliberately does not change migration history. Run `verify_production_durable_email_otp.sql` after repair; test login, wrong attempts, lockout, expiry, resend, replay, cancellation and concurrent sessions with controlled identities. Only then consider individual migration history reconciliation after a full effect comparison.
3. **Resolve migration history per version:** for all 31 unrecorded versions, compare every expected artifact/behavior with production. Apply only proven missing effects in dependency order. Baseline only a version whose complete effects are verified; do not use `db push`, blanket `migration repair`, or manual history insertion as a shortcut.
4. **Billing prerequisite chain:** after complete preflight and approval, reconcile/apply `20261023000000_billing_foundation.sql` → `20261030000000_owner_business_billing_details.sql` → `20261031000000_onboarding_billing_integrity.sql` → `20261031170000_razorpay_atomic_subscription_lifecycle.sql` → `20261031180000_paid_subscription_entitlement_gate.sql`. This is a dependency proposal, not approval to execute. Check prerequisite org/profile/pending-registration schema, duplicates, existing constraints, grants, and every intermediate security change before each step. Keep all paid API gates fail-closed until PostgreSQL checks pass.
5. **Staging acceptance:** apply/reconcile the complete required migration set to the identified staging project using individual guarded steps. Run all SQL tests on PostgreSQL 17, including independent-session OTP, payment/webhook, invitation and outbox concurrency. Run controlled E2E for owner registration/login, onboarding, CSV import/reload, assignment, cross-org denial, Razorpay Test Mode, renewal/refund/expiry, invitations/email and Twilio test account callbacks/calls. Use dedicated test tenants and controlled inbox/number only.
6. **Configuration/operations:** authorized owners check Production variable names and scope (never disclose values), Supabase project match, Resend sender/domain, Razorpay live plan/webhook only after code support is reviewed, Twilio encryption key ring and callbacks while calling remains disabled, cron secret and external reminder schedule. Verify 12-function build inventory, deployment protection, monitoring, backups, restore/PITR, alerting and incident contacts.
7. **Release decision:** production deploy and feature activation require a separate explicit approval after staging sign-off. Keep checkout disabled until billing database and live-mode policy are verified; keep Twilio calls disabled until provider E2E passes. No customer OTP/payment/call/email should be generated as part of automated validation.

## Exact SQL artifacts for operator review

### Read-only production diagnostics

- `supabase/tests/diagnose_production_identity_history.sql`
- `supabase/tests/diagnose_production_primary_artifacts.sql`
- `supabase/tests/diagnose_production_relations_columns.sql`
- `supabase/tests/diagnose_production_indexes_constraints.sql`
- `supabase/tests/diagnose_production_functions.sql`
- `supabase/tests/diagnose_production_triggers_policies.sql`
- `supabase/tests/diagnose_production_acls.sql`
- `supabase/tests/diagnose_production_realtime.sql`
- `supabase/tests/diagnose_production_data_preflight.sql`
- `supabase/tests/preflight_production_durable_email_otp.sql`
- `supabase/tests/verify_production_durable_email_otp.sql` (post-repair verification; read-only)

### Forward repair candidate — not authorized or executed

- `supabase/tests/repair_production_durable_email_otp.sql` — only for the specific 311500 durable email OTP effects after verified identity, complete preflight, backup, and separate operator approval. It preserves existing OTP records, runs transactionally, fails closed on partial/conflicting state, and does not insert migration history.

### Billing migration candidates — not authorized or executed

- `supabase/migrations/20261023000000_billing_foundation.sql`
- `supabase/migrations/20261030000000_owner_business_billing_details.sql`
- `supabase/migrations/20261031000000_onboarding_billing_integrity.sql`
- `supabase/migrations/20261031170000_razorpay_atomic_subscription_lifecycle.sql`
- `supabase/migrations/20261031180000_paid_subscription_entitlement_gate.sql`

No billing forward-repair script is approved by this report: production dependency/object/data reconciliation is not complete enough to author a safe consolidated repair. Do not execute these files until the migration-by-migration reconciliation resolves unknown/intermediate effects and each migration has its own data/conflict preflight.

## Local verification performed for this plan

| Command | Result |
|---|---|
| `npm test -- --maxWorkers=2` | **PASS** — 916 tests passed across 80 files; 0 failed; exit 0. |
| `npm run build` | **PASS** — includes frontend TypeScript build, `tsc --noEmit -p tsconfig.api.json`, and Vite production build. Vite emitted the existing large-chunk warning (main bundle about 1.525 MB minified). |
| `npx tsc --noEmit` | **PASS**, exit 0. |
| `npm run lint` | **PASS**, exit 0; Oxlint emitted warnings (unused identifiers, React effect/dependency/purity warnings and existing style warnings). No lint auto-fixes were applied. |
| `git diff --check` | **PASS**, exit 0. Git emitted line-ending conversion warnings for existing modified files, no whitespace errors. |
| Production SQL / migrations / provider / deploy | **NOT RUN** by design. |

## Remaining risks and GO/NO-GO

1. The exact production cause of the login failure still requires the safe runtime error code and a complete successful OTP preflight; the known schema gaps are credible blockers but do not replace runtime evidence.
2. Billing tables and entitlement RPC are reported absent; checkout and paid access must stay unavailable/fail-closed until their dependency chain is reconciled and validated.
3. Most migration effects remain unknown despite 31 missing history rows. The full catalog output and per-migration decisions are mandatory before any production DDL or history change.
4. Production ACL/default ACL, actual migration creator, RLS, function grants and Realtime data exposure remain high-priority security checks.
5. Live Razorpay support, production variables, Resend domain, Twilio test validation, reminder scheduling, Vercel function inventory, restore drill and deployment accessibility are not verified.

**Final decision: NO-GO for launch to paying customers.** Next action: an authorized operator provides the complete, redacted outputs of the nine read-only production diagnostic files plus the durable OTP preflight and safe Vercel OTP runtime fields. No production repair, migration-history change, provider activation, or deployment should occur before those results are reviewed and explicit operation approval is obtained.
