# ENCRIX Billing and Owner-Onboarding Readiness

**Status: NO-GO for Production migration, checkout, or deployment.** Local application checks are not proof of native PostgreSQL, Supabase Production, or Razorpay behavior. This audit did not access Production, staging, remote databases, provider credentials, or deployment services.

## Executive summary

The reported `PAID_ENTITLEMENT_UNAVAILABLE` is consistent with supplied historical Production findings that `organization_has_active_paid_entitlement(uuid)` and its billing tables are missing. The API fails closed: an RPC failure or non-boolean response is a service error, while a valid false result is an entitlement denial. This error does not prove that any organization is paid or unpaid.

This second-stage audit found an email normalization mismatch. Application registration normalizes by trimming and lowercasing, while the owner-business candidate index only lowercased. The reviewed candidate migration is corrected to use `LOWER(BTRIM(email))`, verifies that exact index expression on same-name existing indexes, and does not rewrite stored customer values. The production preflight duplicate check now uses the same normalization. The postflight previously selected organization/payment identifiers and amounts; it now returns aggregate anomaly counts only. Both production SQL scripts have explicit read-only transaction boundaries.

The approved one-time ₹10,000 onboarding fee is deferred; annual Business remains ₹9,999 (999900 paise). Refund review and period-end cancellation foundations are implemented locally. The selected billing/refund migration chain and its entitlement/lifecycle SQL fixtures have now passed on an isolated native PostgreSQL 17.11 cluster against a synthetic baseline; this does not validate the full Supabase schema or Razorpay Test Mode.

## Evidence classification

A. **Local tests:** see the final local verification section below. Refund admin authorization and decision validation are covered by Vitest; selected SQL behavior was also exercised on native PostgreSQL 17.11.
B. **Native PostgreSQL:** PostgreSQL 17.11 binaries are installed. A separate disposable cluster was initialized under session state, and the ordered billing/refund migrations were applied against a synthetic application baseline. The paid-entitlement and atomic subscription lifecycle SQL fixtures passed and rolled back. This is native-engine evidence for that selected chain, not validation against the full deployed Supabase schema. Docker is unavailable; historical PGlite 0.5.15 / PostgreSQL 18.6 WASM results remain separate synthetic embedded-engine evidence.
C. **Supabase Production:** no live read-only inspection was performed in this audit. Project and schema details below that refer to Production are user-supplied historical evidence and must be refreshed.
D. **Not verified:** current Production schema, migration history, effective RLS/ACLs, target-like backup restoration, native transaction rollback, and deployed end-to-end onboarding/invitation/refund review.
E. **Razorpay Test Mode:** no real test checkout, signature, webhook, cancellation, refund, replay, or out-of-order event was exercised.

## Application and RPC trace

### Owner registration and OTP

- Registration uses registration-specific send/verify endpoints and durable registration ticket RPCs. Verification compares the server-generated HMAC in constant time and registration consumes the verified ticket while creating the organization/profile and deleting pending registration in one database transaction.
- LOGIN and INVITATION continue to use generic durable email OTP RPCs; the registration-specific migration does not replace those generic OTP functions.
- Candidate 310 and migration `20261105160000` both implement a rolling registration send cap. Do not apply both blindly: reconcile the live RPC definition and schema effect first.
- The current application normalizes email with trim + lowercase. Candidate profile email uniqueness and its preflight now match this using `LOWER(BTRIM(email))`. This does not normalize or update existing rows. Existing duplicates must be reviewed manually without deleting customer records.
- The separate pending invitation uniqueness migration uses `lower(email)` rather than trim + lowercase; whitespace-padded legacy values remain a separate compatibility issue. Login lookup behavior for legacy non-normalized stored emails also needs staged compatibility review; do not mutate production email data automatically.

### Billing, payment lifecycle, webhook and entitlement

- Billing routes are server-side and resolve organization scope from the authenticated active owner profile. Payment/entitlement routes reject unauthorized roles and do not accept caller-selected organization IDs as authority.
- Checkout is disabled in the Business catalog. Server configuration accepts Razorpay test credentials only (`rzp_test_...`); no live checkout is approved.
- Payment verification uses provider signatures and verified provider state. Webhooks authenticate the raw body, use provider event identity for replay protection, and reconcile provider subscription/payment state before applying lifecycle changes.
- Lifecycle writes use the restricted payment RPC. The billing candidate grants `service_role` direct SELECT on `billing_payments`, while payment writes occur through the verified RPC. Entitlement remains a server-side RPC and invitation checks fail closed.
- Entitlement requires a current Business subscription, annual amount 999900 paise, provider-active subscription, current period, provider-shaped IDs, and a captured verified payment for that same organization/subscription/current period. Expired, unpaid, cancelled, malformed, or fully refunded states do not qualify.
- Pending refund requests do not mutate payments or entitlement. Partial refunds preserve access only when a processed refund case reconciles to the provider-reported cumulative amount and an active administrator explicitly selected `retain`; `revoke`, unmatched, or unreviewed partial refund states fail closed. Full refunds deny access.
- Owner cancellation uses Razorpay `POST /v1/subscriptions/{id}/cancel` with `cancel_at_cycle_end: true`; the API persists scheduled status only after checking the bound provider subscription, active state, scheduled-change flag, and exact period-end timestamp. If a retry receives a client error, it reads provider state before deciding whether the request succeeded; ambiguous state remains pending for reconciliation. Access remains active through `current_period_end`, and verified charges at or after the cancellation boundary cannot renew entitlement.
- Owners can submit a refund request; only an active global ADMIN can review or approve it. The `/admin/refunds` page is guarded by the existing ADMIN route gate. Backend queue, detail, and review operations independently resolve the active server-side profile and reject other roles. Dashboard counts use service-authorized backend queries; owner accounts cannot see the global queue.
- Review requires a 5–1,000 character decision reason. Approval locks and rechecks the captured payment/refundable balance in the database, persists the reviewer and entitlement choice, then claims the provider operation. A request UUID is reused as Razorpay's refund idempotency key. Timeout/ambiguous outcomes remain in processing for reconciliation; API acceptance is not recorded as completed. Webhooks verify signatures, fetch provider refund and payment state, update the payment lifecycle, and reconcile idempotently.
- Partial-refund entitlement is selected explicitly by the administrator and persisted server-side. Paid access remains only for reconciled partial refunds with the saved `retain` decision; `revoke`, unmatched, and unreviewed cases fail closed. Full refunds cannot retain entitlement. Refund requests alone do not change entitlement.
- Migration `20261106100000_admin_refund_management.sql` adds immutable-by-user audit events and a claim token/lease to prevent concurrent duplicate provider submissions. It depends on `20261105170000_billing_refund_cancellation_workflows.sql`. The matching candidate is `docs/sql/candidate_migrations/20261106100000_admin_refund_management_candidate.sql`.

### Confirmed local corrections present in the worktree

- Failed-to-refunded transition is allowed only for verified full refunds with verification timestamps; payment organization/subscription identity remains immutable.
- Entitlement requires provider-shaped `sub_...` and `pay_...` identifiers.
- A local subscription is activated only when Razorpay reports `active` and a verified captured payment exists for the current period.
- Registration OTP issuance applies a per-email rolling rate limit in the database.
- The 300 candidate unique profile index now matches application trim/lower normalization; conflicting existing index definitions fail closed.
- Production postflight now returns aggregate counts, not tenant/payment identifiers or amounts.

## Commercial model and launch blockers

- Current catalog: Business subscription at ₹9,999/year (999900 paise).
- The one-time onboarding fee is explicitly deferred and is not in checkout.
- A partial refund requires an explicit administrator retain/revoke decision; the endpoint and entitlement gate are locally implemented but not provider/native-DB validated.
- Cancellation is locally implemented as end-of-period through the Razorpay API; support/reconciliation operations need Test Mode validation.
- Razorpay Test Mode end-to-end behavior remains untested. Live checkout is disabled and must remain so pending independent approval.

## Repository migration inventory

This is a repository-level inventory of the 40 migration files in lexical/version order. It summarizes purpose and salient risk, not permission to execute. A missing history row does not prove unapplied effects. Any migration with existing effects, same-name objects, data constraints, or dependencies requires fresh catalog reconciliation. “Transactional” must be confirmed from the exact candidate/source file before application; none is certified Production-safe here.

| Version and file | Purpose / dependencies | Principal risk and security effect |
|---|---|---|
| `20261001000000_init_leadvault.sql` | Foundational organizations, profiles, leads and UUID extension. | Foundational, non-replay-safe schema/data base. |
| `20261001000001_security_hardening.sql` | Initial audit, RLS and security protections. | Replaces policies/triggers/functions; inspect callers and ACLs. |
| `20261006000000_production_telephony_recordings.sql` | Recording and telephony persistence. | Existing object/constraint assumptions; RLS and service access. |
| `20261007000000_otp_authentication_and_onboarding.sql` | OTP, invitations, pending registrations and phone auth. | OTP schema/function and constraint changes; existing records matter. |
| `20261008000000_email_otp_authentication.sql` | Durable generic email OTP. | Sensitive auth table/RPC/ACL changes; do not replay if present. |
| `20261012000000_phase17_realtime_crm_telephony.sql` | Realtime CRM/telephony objects. | Publication and trigger changes. |
| `20261013000000_phase18_secure_student_details_zero_phone.sql` | Restricted student detail view/RPC. | Replaces view/functions and access policies. |
| `20261014000000_phase20_smart_lead_distribution.sql` | Lead distribution/assignment schema and routines. | Data constraints and function grants. |
| `20261015000000_phase21_smart_follow_up_engine.sql` | Follow-up scheduling/concurrency. | Index/function/policy changes; check existing rows. |
| `20261018000000_phase22_security_critical_remediation.sql` | Security remediation across CRM. | Replaces security-definer functions, views and policies. |
| `20261019000000_phase22_phone_exposure_remediation.sql` | Limits phone exposure. | View/function replacements and access changes. |
| `20261020000000_phase23_followup_reminder_concurrency.sql` | Reminder concurrency routine. | Function/ACL replacement. |
| `20261021000000_phase23_7_production_blocker_remediation.sql` | Production access/RLS fixes. | Broad policy/view/grant effects; effective privileges need review. |
| `20261022000000_phase23_8_active_profile_rls.sql` | Active profile helper and policy enforcement. | Definer helper and dynamic policy updates. |
| `20261023000000_billing_foundation.sql` | Subscription/payment/webhook tables, indexes, RLS and grants. | Non-idempotent tables; source grants broad. Use only reviewed candidate after preflight. |
| `20261023120000_secure_caller_enrollment_bridge_persistence.sql` | Caller enrollment bridge persistence. | New persistence and RPC tenant permissions. |
| `20261024100000_phase24_1_security_remediation.sql` | Additional security constraints/triggers/policies. | Drops/replaces existing objects; inspect dependent clients. |
| `20261024120000_phase24_3_secure_telecaller_lead_access.sql` | Telecaller lead access. | RLS and function changes can alter team access. |
| `20261024130000_phase24_7_server_telecaller_leads.sql` | Server-side telecaller lead operations. | Definer RPC and tenant isolation. |
| `20261027000000_phase32_realtime_publications.sql` | Realtime publication membership. | Publication changes can affect live events. |
| `20261028000000_phase33_realtime_notifications.sql` | Realtime notifications. | Trigger/publication behavior and policy assumptions. |
| `20261030000000_owner_business_billing_details.sql` | Business contact fields and email/owner uniqueness. | Duplicate data can abort; candidate exact-index guard checks definition. |
| `20261030120000_owner_csv_import_persistence.sql` | CSV import columns/indexes/RPCs. | Data schema and server function ACL effects. |
| `20261031000000_onboarding_billing_integrity.sql` | Registration OTP attempts, atomic owner registration, payment identity trigger. | Replaces registration RPC and drops legacy failure RPC; adds constraints. Generic login/invitation OTP remains separate. |
| `20261031120000_sanitized_lead_refresh_signals.sql` | Sanitized lead refresh signal. | Dynamic trigger/publication changes. |
| `20261031130000_public_leads_privilege_hardening.sql` | Public lead privileges/default ACL hardening. | Default ACL effect depends on object creator; audit role-specific defaults. |
| `20261031140000_security_definer_search_path_hardening.sql` | Definer search-path hardening. | Function settings/definitions change. |
| `20261031150000_durable_email_otp_attempts.sql` | Durable generic email OTP ticket RPCs. | Sensitive authentication implementation; do not replay where present. |
| `20261031160000_organization_twilio_calling.sql` | Organization-scoped Twilio calling. | Calling schema/security; not required for billing gate. |
| `20261031170000_razorpay_atomic_subscription_lifecycle.sql` | Verified payment/subscription lifecycle RPC and indexes. | Non-idempotent index/state transitions; use provider-active candidate. |
| `20261031180000_paid_subscription_entitlement_gate.sql` | Paid entitlement RPC. | Critical authorization gate; exact signature/body/ACL required. |
| `20261101090000_followup_email_outbox.sql` | Follow-up email outbox. | Automation feature and independent schema; keep disabled until verified. |
| `20261101100000_unique_pending_invitations.sql` | Pending invitation dedupe/index. | Duplicate rows may block unique index; normalization is lower-only. |
| `20261104120000_founding_pilot_entitlements.sql` | Optional time-limited pilot grant/audit functions. | Separate access path; not required for paid billing and not to activate without approval. |
| `20261105130000_razorpay_failed_refund_transition.sql` | Narrow failed-to-verified-full-refund transition. | Replaces payment trigger function; verify exact trigger attachment. |
| `20261105140000_paid_entitlement_provider_identity.sql` | Provider-shaped identifiers for entitlement. | Replaces entitlement logic; service-only execute must remain. |
| `20261105150000_razorpay_active_subscription_required.sql` | Require provider-active status before local activation. | Replaces lifecycle RPC; verify exact signature and ACL. |
| `20261105160000_registration_otp_send_rate_limit.sql` | Rolling registration OTP send cap. | Replaces registration issue RPC; overlaps candidate 310 effect. |
| `20261105170000_billing_refund_cancellation_workflows.sql` | Adds refund request/review audit records, service-only RPCs, cancellation request state, and updates entitlement/lifecycle behavior. | Applied successfully in the isolated native PostgreSQL 17.11 synthetic-baseline run; still requires full Supabase-schema/RLS/ACL validation and Razorpay Test Mode tests. |
| `20261106100000_admin_refund_management.sql` | Adds refund audit events and tokenized processing claims; hardens duplicate submissions and records provider/review transitions. | Applied successfully in the isolated native PostgreSQL 17.11 synthetic-baseline run; still requires full Supabase-schema/RLS/ACL validation and Razorpay Test Mode recovery tests. |

## Candidate migration order and status

Do not execute this list until a fresh Production read-only preflight, complete backup with tested restore, native PostgreSQL 17 validation, and human approval.

| Order | Candidate | Main prerequisite / risk | Status |
|---|---|---|---|
| 1 | `20261023000000_billing_foundation_candidate.sql` | Existing org schema/roles/extensions; creates non-idempotent billing tables and ACL/RLS. | BLOCKED pending current preflight/native validation. |
| 2 | `20261030000000_owner_business_billing_details_candidate.sql` | Profiles/org/pending schema and normalized duplicate count 0; exact same-name index checks. | BLOCKED pending current preflight/data review. |
| 3 | `20261031000000_onboarding_billing_integrity_candidate.sql` | Base OTP/onboarding and orders 1–2; replaces registration functions and drops legacy RPC. | BLOCKED pending dependency/overload review. |
| 4 | `20261031170000_razorpay_atomic_subscription_lifecycle_candidate.sql` | Billing tables and trigger; non-idempotent index. | BLOCKED pending native integration and conflicts. |
| 5 | `20261031180000_paid_subscription_entitlement_gate_candidate.sql` | Lifecycle tables/RPC; create-only function and ACL. | BLOCKED pending native integration and exact object absence. |
| 6 | `20261105130000_razorpay_failed_refund_transition_candidate.sql` | Existing identity trigger/columns and exact transition. | BLOCKED; optional forward correction only if migration state requires it. |
| 7 | `20261105140000_paid_entitlement_provider_identity_candidate.sql` | Existing entitlement function. | BLOCKED; apply only if its predicate is missing. |
| 8 | `20261105150000_razorpay_active_subscription_required.sql` | Existing lifecycle RPC. | BLOCKED; source forward correction not listed in candidate folder. |
| 9 | `20261105160000_registration_otp_send_rate_limit.sql` | Registration OTP table/RPC. | BLOCKED; overlap with candidate 310. |
| 10 | `20261105170000_billing_refund_cancellation_workflows_candidate.sql` | Billing tables, lifecycle and entitlement corrections from orders 1–8. | BLOCKED; apply only after state reconciliation, native PG and provider tests. |

The minimum approved-policy path is orders 1–5, applicable forward corrections 6–8, then 10. Item 9 is separate OTP work unless candidate 310 lacks the rate limit. The billing policy migration depends on the exact billing schema and entitlement/lifecycle functions; it must not be applied before them. Twilio, outbox, pilot, and unrelated CRM migrations are not billing prerequisites. Never mark migration history manually or replay based on history alone.

## Locked policy implementation status

- **Onboarding:** deferred. Checkout remains exactly ₹9,999/year; no one-time fee field, payment, or combined checkout amount is added.
- **Refunds:** owner request is recorded separately; request submission does not modify payment/refund totals or entitlement. Administrator decisions record reviewer, timestamp, amount, action and audit event. Approval is service-side, balance-checked under payment row lock, and uses Razorpay refund processing with a stable idempotency identity. The signed webhook fetches provider refund/payment state and reconciles it to the approved request. No provider integration test has run.
- **Cancellation:** owner-authorized request calls the documented period-end cancellation operation. Local state becomes scheduled only after matching provider IDs, active status, a scheduled-change flag, and a scheduled timestamp equal to period end are confirmed. Provider 4xx triggers a provider-state read before failure; ambiguous outcomes remain pending. Access remains through paid period end, and verified charges at or after that boundary cannot renew entitlement. An early cancelled webhook cannot shorten paid-through access.
- **Administrator UX:** `/admin/refunds` is available through the ADMIN-only route, desktop sidebar, and mobile admin navigation. Queue, detail, and review endpoints repeat authorization checks server-side; aggregate counts come from service-authorized backend queries, never owner-visible data.
- **Administrator identity:** ENCRIX's existing global `ADMIN` role is used; no new role was introduced. Server API authentication verifies the current active profile from Supabase. The existing profile-protection trigger prevents self-elevation, and `grant_platform_admin(uuid)` is executable only by `service_role`.

## Production SQL artifacts

- `docs/sql/production_preflight.sql`: catalog and aggregate-only checks, inside `BEGIN TRANSACTION READ ONLY` / `ROLLBACK`; confirms extensions, data duplicates, indexes/constraints, functions, triggers, RLS/policies, migration history and duplicate history versions. It is a read-only operator script, not executed in this audit.
- `docs/sql/production_postflight.sql`: checks final functions, objects, permissions, policies/triggers and aggregate billing invariants, inside an explicit read-only transaction. The anomaly output contains counts only, not tenant or payment records. Run only after approved migration and verify each result manually.

Before either script, the operator must visually confirm the SQL Editor project reference. Export and restore the complete database backup to a disposable PostgreSQL 17.11 environment before migration approval. Stop on any missing prerequisite, duplicate, conflicting object, nonmatching signature/definition, unexpected ACL, or nonzero anomaly count. No migration is certified safe solely from PGlite.

## Verification status and test plan

Historical disposable PGlite results cover a synthetic schema only. On 2026-11-06, a separate local PostgreSQL 17.11 cluster with a synthetic application baseline successfully applied the ordered billing/refund sequence (`20261023000000`, `20261030000000`, `20261031000000`, `20261031170000`, `20261031180000`, `20261105130000`, `20261105140000`, `20261105150000`, `20261105170000`, and `20261106100000`). The paid-entitlement and Razorpay atomic subscription lifecycle SQL fixtures passed; each fixture rolled back its data. This does not certify the full migration set, target Supabase schema, Production catalog/history, or a target-like backup restoration.

The admin UI route is `/admin/refunds`. Its API operations are `GET /api/billing/refund-requests` (queue and backend summary with status/date/search/pagination), `GET /api/billing/refund-detail?id=…` (request and audit history), and `POST /api/billing/refund-review` (decision and provider workflow). Owner refund requests continue through `POST /api/billing/refund-request` and cannot invoke review actions.

Latest local validation (2026-11-06): `npm test` passes all 90 files and 1,008 tests with the eight-worker default. `npm run build` and TypeScript/API checks pass; the largest emitted file is 729.40 kB (729,407 bytes; 201.21 kB gzip). `npm run lint` exits successfully with 140 warnings (136 unused-variable warnings and 4 unnecessary-escape warnings), with no lint errors. This follow-up found 41 ordered source migrations and 16 SQL regression files; none were run. Docker Desktop and Supabase CLI 2.121.0 are installed, but the Docker daemon is unavailable and the local Supabase database could not start. Port 5432 is owned by an unidentified existing `postgres.exe` process; it was not connected to or modified. Supabase ports 54322–54324 are not listening, and PostgreSQL client tools are not available on PATH. A separate staging project is configured locally but was not contacted. An earlier report records a selected billing/refund chain and synthetic PostgreSQL backup/restore; that historical evidence was not repeated and does not establish full Supabase-schema validation. No verified Razorpay Test Mode credential bundle was available. Twilio credentials appear in the local staging configuration, but Test Account status was not established; no provider request occurred. No Supabase, staging, or Production migration was applied.

Required next validation: restore a complete approved backup into a disposable native PostgreSQL 17.11 cluster, validate the full migration chain and failure-injection tests against the actual Supabase-compatible base schema, then complete Razorpay Test Mode provider flows and owner registration → paid checkout → invitation end-to-end in an approved non-production environment. No live charges, emails, calls, remote database writes, or deployments are authorized by this report.

## Razorpay Test Mode checklist

1. Use only server-side test credentials with `rzp_test_...`; never expose secrets in `VITE_*` or logs.
2. Verify the plan is INR, Business, 999900 paise/year and intended subscription count; checkout remains disabled until separate staging approval.
3. Test successful, failed, pending, authorized-only, failed-then-captured, full refund, partial refund, failed-then-refunded, duplicate, replayed, and out-of-order events.
4. Verify signatures against raw webhook body and idempotency under retries.
5. Verify provider subscription is genuinely `active`, current-period capture is verified, identifiers are provider-shaped, and all IDs remain organization/subscription scoped.
6. Confirm entitlement denial for unpaid, expired, canceled, full-refunded, malformed identity and cross-organization fixtures.
7. Confirm partial refund behavior against an explicitly approved policy before accepting the result.
8. Confirm invitation OTP is issued only after active-owner authentication and paid entitlement success.

## Known risks and explicit decision

**NO-GO.** Do not execute a Production migration, enable checkout, alter secrets, grant pilot entitlement, or deploy. The administrator review UI and local API workflow now exist, and the selected billing/refund migrations passed against an isolated synthetic PostgreSQL 17.11 baseline. A complete schema/backup-restore validation, Razorpay Test Mode end-to-end checks, staging workflow review, and operational approval are still required. No Production inspection or connection was performed for this local implementation.
