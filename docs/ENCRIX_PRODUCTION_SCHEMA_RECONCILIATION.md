# ENCRIX Production schema reconciliation

**Target:** Supabase project `wrzoqxesffbfirjgotbr`. **Updated:** 2026-11-05 from operator-supplied preflight and security summaries. This is a read-only reconciliation; no Production connection or SQL execution occurred. Findings below are operator-supplied and not independently queried by this workspace.

## Historical Production evidence

Latest operator-reported results:

- Present: `organizations`, `profiles`, `pending_registrations`; core profile columns/constraints; core org/profile/pending-registration constraints.
- Missing: `organization_subscriptions`, `billing_payments`, `billing_webhook_events`, `organization_pilot_entitlements`, `organization_pilot_entitlement_events`, `registration_otp_attempts`; expected billing columns; organization/pending-registration business details; `pending_registrations.otp_ticket_id`; listed billing/registration/pilot functions; matching triggers; billing indexes/constraints; `profiles_email_unique_lower`; `organizations_owner_id_unique`.
- Aggregate duplicate counts: normalized profile emails `0`; organization owner IDs `0`.
- History: `20261001000000` and `20261001000001` recorded; 070, 080, 230, 300, 310, 311700, 311800 and 411 not recorded.

The current summary does **not** include complete RLS/policy rows, effective table/function grants, exact function overload catalog, all index/constraint definitions, or the full history of all 34 repository migrations. The `REVIEW_REQUIRED`/unknown state for those items remains. Do not treat an omitted query result as an empty catalog.

Earlier operator verification reported the durable email OTP columns/index/RPC definitions and service-role permissions present, and UUID extension/default verified. Those are important counterexamples to inferring “not recorded” means “not applied”; recheck them in the current catalog set. The repository also contains October schema snapshots without a verified project identity. At least one includes billing DDL, which conflicts with the latest Production absence report; these files are stale/unattributed and must not override the new Production results or be used as execution input.

The exact paid-entitlement RPC is reported absent and its three required billing tables are reported absent. That is sufficient to explain the invite API's fail-closed 503, conditional on the supplied current catalog summary. No live database evidence was collected by this agent.

## Latest migration-effect classification

“Absent” below means the operator's catalog summary affirmatively reports the relevant target object absent. “Partial” means some migration effects are present and/or omitted effects remain unknown. “Unknown” means the current result set does not establish application state. A history status is kept separate from effect status.

| Migration | History / current effect evidence | Classification and replay guidance |
|---|---|---|
| `20261001000000` | Recorded; organizations, profiles and core constraints reported present. UUID extension/default was verified in an earlier operator check. Full base schema, policies and helper definitions not in latest summary. | **PARTIAL / REVIEW. Never replay.** Verify all base objects/policies/function definitions and schema grants. |
| `20261001000001` | Recorded; no current full trigger/function/view/grant comparison supplied. | **UNKNOWN / REVIEW. Never replay.** Recorded does not prove the current security-hardening definitions. |
| `20261006000000` | No current object-level findings supplied for webhook/recording effects. | **UNKNOWN. Do not replay from history alone.** |
| `20261007000000` | Not recorded; `pending_registrations` and core profiles exist. Invitation/phone OTP tables, profile status/phone_verified, policy definitions and constraints were not included in the latest summary. | **PARTIAL / REVIEW. Do not replay wholesale.** Its `DROP CONSTRAINT` and unguarded policy creation can replace/conflict with existing state. |
| `20261008000000` | Not recorded; profiles and pending registrations exist. Prior OTP review established `email_otps` durable 11-column state, ticket index and three email RPCs; current summary omitted 080-specific unique constraint/policy details. | **PARTIAL, with later durable OTP effects reported present. Do not replay.** It drops/recreates pending-registration phone/email constraints and creates policies; reconcile exact effects first. |
| `20261012000000`–`20261022000000` | No current full object/policy/ACL/publication comparison included. These include lead privacy, follow-up, active-profile and server-access security. | **UNKNOWN / RELEASE BLOCKER. Do not replay.** Review each migration in chronological order before later migrations. |
| `20261023000000` | Not recorded; all three target billing tables reported absent. | **BILLING FOUNDATION EFFECTS ABSENT by target table evidence.** Still requires complete RLS/ACL/role/extension/prerequisite review and staging validation before an execution file is prepared. |
| `20261023120000`–`20261028000000` | No current object, trigger, function, publication or privilege results supplied. | **UNKNOWN.** These are intervening migrations in chronological history; do not skip/replay until their effects are reconciled. |
| `20261030000000` | Not recorded; business fields and both named unique indexes reported absent; both duplicate counts are zero. | **TARGET EFFECTS REPORTED ABSENT; data precondition passes at reported snapshot.** Existing column types/prerequisites and full surrounding schema still require validation; additive `IF NOT EXISTS` is not a type check. |
| `20261030120000` | No current lead import/index/trigger/RPC results supplied. | **UNKNOWN.** Not a direct entitlement dependency, but part of chronology. |
| `20261031000000` | Not recorded; `registration_otp_attempts`, pending `otp_ticket_id`, listed registration/payment functions, and matching trigger reported absent. Billing tables are absent. The migration also drops `record_registration_otp_failure(uuid,text)`, which was not reported. | **PARTIAL / BLOCKED.** Target effects are mostly reported absent, but legacy-drop function presence/dependencies, policies, grants and exact constraints require a new check. Do not replay before 230/300 and OTP review. |
| `20261031120000`–`20261031160000` | No current signal-table, lead ACL/default ACL, definer search path, email OTP, or Twilio catalog comparison provided. Earlier operator verification reports 311500 email OTP effects present. | **UNKNOWN/PARTIAL. Do not replay.** 311300/311400 are security-sensitive; 311500 may need history reconciliation after exact recheck; 311600 is unrelated to paid entitlement. |
| `20261031170000` | Not recorded; its two alter-target tables are reported absent and `apply_verified_razorpay_payment` is absent. | **EFFECTS ABSENT by missing target tables/function.** It is still dependency-blocked until 230/310 and exact data/constraint preconditions are validated. |
| `20261031180000` | Not recorded; `organization_has_active_paid_entitlement(uuid)` reported absent; billing dependencies absent. | **EFFECT ABSENT.** Apply only after the verified foundation and 311700; never substitute application bypass. |
| `20261101090000`–`20261101100000` | No current outbox/invitation uniqueness objects or duplicate counts supplied. | **UNKNOWN; not needed for entitlement restoration.** Do not replay blindly. |
| `20261104120000` | Not recorded; both pilot tables and grant/revoke functions reported absent; base paid RPC also absent. | **PILOT EFFECTS REPORTED ABSENT; optional and blocked by paid chain.** Keep grants disabled and prepare/apply only after independent review. |

The repository currently contains **34** migration files. Older audit notes saying 33 files / 31 later versions are stale. The updated full-history query lists all 34 versions; the summarized latest result only provided ten statuses, so the remaining statuses still require output review.

### Complete repository version status

| Version | Migration | Current classification from available Production evidence |
|---|---|---|
| 20261001000000 | init_leadvault | Recorded; base tables/core constraints present; full object/policy definitions unknown. |
| 20261001000001 | security_hardening | Recorded; function/view/trigger/grant definitions unknown. |
| 20261006000000 | production_telephony_recordings | Unknown. |
| 20261007000000 | otp_authentication_and_onboarding | Not recorded; partial effects present, exact invitation/phone OTP/security state unknown. |
| 20261008000000 | email_otp_authentication | Not recorded; partial effects present, durable OTP subsystem was previously operator-verified, remaining constraints/policies unknown. |
| 20261012000000 | phase17_realtime_crm_telephony | Unknown. |
| 20261013000000 | phase18_secure_student_details_zero_phone | Unknown. |
| 20261014000000 | phase20_smart_lead_distribution | Unknown. |
| 20261015000000 | phase21_smart_follow_up_engine | Unknown. |
| 20261018000000 | phase22_security_critical_remediation | Unknown. |
| 20261019000000 | phase22_phone_exposure_remediation | Unknown. |
| 20261020000000 | phase23_followup_reminder_concurrency | Unknown. |
| 20261021000000 | phase23_7_production_blocker_remediation | Unknown. |
| 20261022000000 | phase23_8_active_profile_rls | Unknown. |
| 20261023000000 | billing_foundation | Not recorded; all three created billing tables reported missing. |
| 20261023120000 | secure_caller_enrollment_bridge_persistence | Unknown. |
| 20261024100000 | phase24_1_security_remediation | Unknown. |
| 20261024120000 | phase24_3_secure_telecaller_lead_access | Unknown. |
| 20261024130000 | phase24_7_server_telecaller_leads | Unknown. |
| 20261027000000 | phase32_realtime_publications | Unknown. |
| 20261028000000 | phase33_realtime_notifications | Unknown. |
| 20261030000000 | owner_business_billing_details | Not recorded; expected business columns and two unique indexes reported missing; supplied duplicate counts are zero. |
| 20261030120000 | owner_csv_import_persistence | Unknown. |
| 20261031000000 | onboarding_billing_integrity | Not recorded; registration table/column/RPC/trigger effects reported missing; legacy function drop target unreported. |
| 20261031120000 | sanitized_lead_refresh_signals | Unknown. |
| 20261031130000 | public_leads_privilege_hardening | Unknown; high security impact. |
| 20261031140000 | security_definer_search_path_hardening | Unknown; high security impact. |
| 20261031150000 | durable_email_otp_attempts | Not recorded in earlier history summary; effects reported present by prior operator verification; rerun exact function/ACL checks. |
| 20261031160000 | organization_twilio_calling | Unknown and not required for entitlement. |
| 20261031170000 | razorpay_atomic_subscription_lifecycle | Not recorded; alter-target billing tables and RPC reported absent. |
| 20261031180000 | paid_subscription_entitlement_gate | Not recorded; entitlement RPC reported absent. |
| 20261101090000 | followup_email_outbox | Unknown; not required for entitlement. |
| 20261101100000 | unique_pending_invitations | Unknown; not required for entitlement. |
| 20261104120000 | founding_pilot_entitlements | Not recorded; pilot tables and grant/revoke functions reported missing; optional. |

The 34-version status table separates “unknown” from “missing”; no unnamed or omitted effects have been inferred from migration history.

## Dependency chain and migration findings

| Version | Dependencies and effect | Safety / conflict observations |
|---|---|---|
| `20261001000000` | Base organizations/profiles/CRM tables; `uuid-ossp` in `extensions`; UUID defaults; helper functions; broad initial RLS and policies. | `CREATE TABLE IF NOT EXISTS` can leave a same-name table with a mismatching shape undetected. Existing policies are created without guards and may conflict. This baseline cannot be replayed based on history alone. |
| `20261001000001` | Initial hardening over base audit/lead/call objects: audit trigger functions/triggers, view, privileged call function, grants. | Drops/recreates named triggers and replaces functions/views; SECURITY DEFINER and search paths in this early migration need independent security review. |
| `20261007000000` | Requires organizations/profiles and UUID extension; creates invitations, pending registration and phone OTP tables; extends profile status/phone fields; RLS and policies. | `DROP CONSTRAINT IF EXISTS profiles_status_check` replaces that constraint. Existing same-name tables and policies may conflict or be incomplete. |
| `20261008000000` | Requires profiles, invitations, pending registration, extension; creates email OTP table and email columns/indexes. | Drops phone/email uniqueness constraints on pending registrations and recreates email uniqueness. Preserves rows but constraints can fail if preexisting duplicate emails. |
| `20261023000000` | Requires `public.organizations`; creates subscription, payment, webhook tables, keys/checks/FKs/indexes, RLS, service-role-only table access/policies. | Plain `CREATE TABLE`/index/policy statements are not idempotent and the file has no explicit transaction. Atomicity therefore depends on the runner; a failure may leave earlier statements applied if the runner does not wrap the complete file. No intentional row rewrite. |
| `20261030000000` | Requires organizations, profiles, pending registrations; adds business contact columns and unique lower-email/owner indexes. | Additive `IF NOT EXISTS` does not verify existing type/default. Unique indexes fail on duplicates. No explicit transaction; atomicity depends on the runner. Duplicate preflight must return counts only; do not delete records to make the index succeed. |
| `20261031000000` | Requires 070/080 registration schema plus billing tables. Adds registration attempt state/columns; replaces service-only registration OTP/owner registration functions; adds billing constraints and payment identity trigger/function. | No explicit outer transaction. Drops the prior `record_registration_otp_failure(uuid,text)` function and a named policy/trigger before replacement. Owner creation inserts org/profile and consumes/deletes pending registration in its transaction. Named constraints are checked, but partial prior state and wrong same-name definitions abort. Review this migration beyond entitlement because it alters OTP/onboarding. |
| `20261031170000` | Requires billing foundation and 310 payment-identity trigger/constraints. Adds `billing_payments.amount_refunded_paise bigint NOT NULL DEFAULT 0`, subscription `razorpay_total_count integer`, validated constraints, period index, and atomic verified-payment RPC. | Explicit transaction. The new refund amount defaults to zero for existing rows. Existing columns of wrong type/nullability or invalid values fail preflight/constraint validation. Function performs payment upsert/state transitions when later called; migration itself does not update payment rows. No drops/deletes. |
| `20261031180000` | Requires all billing lifecycle columns/constraints and payment RPC chain. Creates read-only boolean paid-entitlement RPC; revokes PUBLIC/anon/authenticated and grants service_role. | Explicit transaction. `CREATE FUNCTION` (not replace) fails if a same-signature object already exists; inspect conflict before any apply. No customer-data mutation. |
| `20261104120000` | Requires organizations/profiles, `uuid_generate_v4()` in extensions, and the paid entitlement RPC/tables. Creates pilot grant + audit tables, index, grant/revoke functions and replaces the existing entitlement RPC to include an active non-revoked unexpired pilot row. | Explicit transaction. `CREATE TABLE`/grant/revoke functions fail on same-name objects; `CREATE OR REPLACE` changes entitlement semantics, so inspect existing function ACL/body/owner first. RLS is enabled and direct table grants revoked, including service_role; SECURITY DEFINER functions are service_role-only. No grants are inserted by migration. |

## Exact dependency order for candidate entitlement restoration

1. Confirm base organization/profile schema and extension effects of `20261001000000`; validate the policy/security baseline `20261001000001`.
2. Confirm `20261007000000` and `20261008000000` effects needed by owner registration and 310 (pending registrations, profiles email, and OTP fields/functions as applicable). Reconcile these before the billing chain; a history gap is not proof of absence.
3. `20261023000000_billing_foundation.sql`.
4. `20261030000000_owner_business_billing_details.sql`.
5. `20261031000000_onboarding_billing_integrity.sql`.
6. `20261031170000_razorpay_atomic_subscription_lifecycle.sql`.
7. `20261031180000_paid_subscription_entitlement_gate.sql`.
8. Optional pilot extension: `20261104120000_founding_pilot_entitlements.sql`, after review and test; keep its API flag disabled until separately authorized.

Migration `20261031160000_organization_twilio_calling.sql` is not a dependency of the billing/entitlement chain and is excluded. Do not execute it to restore invitations.

## What the read-only preflight checks

The preflight lists expected history versions; table existence/object kinds; required organization, profile, registration and billing columns with catalog types/nullability/defaults; aggregate duplicate normalized emails/owner IDs; constraints/indexes and their definitions; RPC signatures, definitions, owner, return type, SECURITY DEFINER/search-path settings, and role permissions; table RLS/policies; and relevant payment triggers. It does not select customer rows or execute application RPCs. Manually confirm the SQL Editor's project reference before execution.

The updated [billing postflight](sql/ENCRIX_BILLING_POSTFLIGHT.sql) now checks all 34 repository migration versions and includes registration-ticket columns/functions, the legacy function 310000 would drop, billing/pilot/OTP RLS and table privileges, trigger definitions, exact function definitions, and expected named indexes/constraints. The expanded function-preflight also returns unexpected same-name overloads for review. A `PRESENT` row is not a pass until its exact definition, validity, owner, ACL, RLS and trigger behavior match reviewed migration source. The expanded full-history/function-overload queries were prepared after the operator's run, so rerun those read-only checks.

## Current decision and script gate

No Production execution file is prepared. The supplied table/column/function absences establish missing effects for parts of the chain, but not complete reconciliation of the chronological prerequisites or the current security surface. In particular, full RLS/policy rows, effective grants/default ACLs, function overload/owner/ACL results, and migration effects 060–220/2312–280/3012/3112–3116/010900–011000 are not present in the summary. Migration 310 also has an unreported legacy-function drop target. Generating write scripts now would violate the requested complete-reconciliation gate.

The minimum paid-entitlement chain, **conditional on those release prerequisites**, remains `20261023000000` → `20261030000000` → `20261031000000` → `20261031170000` → `20261031180000`. Reconcile earlier chronological migrations effect-by-effect; replay none wholesale. Pilot migration `20261104120000` is optional and separate. Do not apply `20261031160000` to restore entitlement.

Before script preparation: obtain all eight raw result sets (especially RLS/policies and function/table permissions), full 34-version history output, exact constraints/indexes/function definitions and trigger rows; add a read-only check for `record_registration_otp_failure(uuid,text)` and dependencies; recheck the earlier email OTP repair state; then test candidate version-by-version on a disposable PostgreSQL 17 Supabase-compatible database. No Production SQL or migration history change is authorized by this review.

Previous local suite passed 947/947 tests across 86 files. The reconciliation-focused local rerun passed 65 tests across 8 files; `npx tsc --noEmit` and `git diff --check` passed. The supplied Production finding summary was not available as raw output for this review. No PostgreSQL parser/client was available, no SQL was executed on PostgreSQL, and no staging database test was performed in this pass.

## Final security findings addendum — 2026-11-05

The operator's latest security summary reports that only migrations `20261001000000` and `20261001000001` are recorded and the other 32 repository versions are not recorded. Continue treating migration history as advisory: durable email OTP objects are specifically reported present although its migration is unrecorded. Do not replay based on history.

### RLS and effective access

RLS is reported enabled but not forced on inspected application tables. `lead_assignments`, `messages`, and `user_sessions` reportedly have no policies. For ordinary `anon`/`authenticated` roles, a table grant plus enabled RLS but no applicable policy normally yields no row access (default deny); it can still permit relation-level operations or metadata visibility and can break intended workflows. A matching permissive policy can allow access, and multiple permissive policies OR together. RLS does not protect table owners, superusers, or `BYPASSRLS` roles unless forced; forced RLS still does not constrain superusers/`BYPASSRLS`. The supplied summary lacks per-table owners, effective role attributes/memberships, and complete policy expressions, so exact effective access is not yet proven. The final catalog audit reports table ownership, role bypass/superuser flags, schema CREATE/USAGE, policy expressions, and effective ACL booleans.

No policies on `lead_assignments`, `messages`, or `user_sessions` should be treated as intentional default-deny until API access paths are verified. Do not add permissive policies just to restore functionality; use the established server-side API or reviewed tenant-scoped policies.

### Grants, defaults, and billing risk

Repository-wide search found explicit `ALTER DEFAULT PRIVILEGES` only in `20261031130000_public_leads_privilege_hardening.sql`. It revokes public-schema table/sequence defaults for `PUBLIC`, `anon`, `authenticated`, and `service_role` **for role `postgres`**, and revokes schema-specific function defaults for named API roles. PostgreSQL's built-in default EXECUTE for `PUBLIC` is global and is not removed by that schema-specific revoke. The migration preflight aborts on certain unsafe global defaults for the `postgres` creator; reconcile it with actual Production `pg_default_acl` before considering replay. Defaults are creator-role-specific, so changing only `postgres` does not secure objects created by another role.

Migration `20261023000000_billing_foundation.sql` enables RLS, revokes table access from `PUBLIC`, `anon`, and `authenticated`, grants `ALL` to `service_role`, and creates `FOR ALL` policies for `service_role`. Its UUID primary-key defaults create no sequences. Those explicit table revokes mitigate the reported table default ACLs on the resulting billing tables if the statements complete. The migration has no explicit transaction, however; a statement-by-statement run can expose default grants between table creation and later revokes. Any future reviewed execution copy should be transaction-bounded and tested against the actual migration creator/default ACLs.

The current `ALL` grant to `service_role` exceeds observed API methods: subscriptions and webhook events use SELECT/INSERT/UPDATE; payments are read directly by the API, while payment writes use the SECURITY DEFINER atomic RPC. The minimum-privilege target should be SELECT/INSERT/UPDATE on `organization_subscriptions` and `billing_webhook_events`, SELECT on `billing_payments`, and no direct grants to `anon`, `authenticated`, or `PUBLIC`. Confirm complete API usage before narrowing. `service_role` is trusted cross-tenant backend access and normally bypasses RLS; isolation depends on authenticated organization resolution in server code and organization checks in write RPCs. Do not claim service-role policies provide tenant isolation.

Migration 310 registration RPCs explicitly revoke PUBLIC/anon/authenticated and grant `service_role`; the registration-attempt table revokes direct grants from those roles including `service_role`, with a service-role policy. The trigger function `protect_billing_payment_identity()` has a fixed `pg_catalog, pg_temp` path and schema-neutral body but lacks an explicit EXECUTE revoke. It is trigger-only, reducing direct-call risk, but a reviewed source correction should explicitly revoke EXECUTE from `PUBLIC`, `anon`, and `authenticated`. Migrations 311700/311800, optional pilot RPCs, and email OTP RPCs explicitly revoke API-role/PUBLIC EXECUTE and grant service_role. Sensitive functions must continue doing so because a PUBLIC default EXECUTE exists.

### SECURITY DEFINER helpers

The migration lineage defines/replaces `get_auth_profile`, `get_auth_role`, `get_auth_org_id`, and `is_caller_active` as SECURITY DEFINER. Migrations 190/220 set their path to `public, pg_temp`; the 220 bodies use schema-qualified `public.profiles`, `auth.uid()`, and `public.is_active_authenticated_profile()`. Object resolution is explicit. Their remaining concern is reliance on `public` appearing in the path: confirm untrusted roles have no effective CREATE on public (180 revokes CREATE from PUBLIC and anon, but verify current ACL/memberships). Source grants profile helpers to authenticated/service_role and revokes PUBLIC/anon. `is_caller_active` is later hardened by 311400 to `pg_catalog, pg_temp` and delegates by qualified name.

`prevent_audit_tampering` is SECURITY DEFINER, later set to `public, pg_temp`, and only raises an exception without resolving application relations. Its path can be moved catalog-first during a future security review, but it is not a billing dependency. Do not replay 190/220/311400 based on absent history; compare definitions and ACLs first.

### Trigger inventory and minimum changes

The operator's final CSV omitted its trigger section; it does not establish trigger absence. Run the standalone [trigger inventory](sql/ENCRIX_PRODUCTION_TRIGGER_INVENTORY.sql), which returns one row per target table even if absent or trigger-free, plus each non-internal trigger's enabled state and function security metadata/definition.

Before billing migration approval, minimum safety work is: (1) retrieve full Production default-ACL scope/creator and schema/table/function permissions; (2) reconcile 311300's global-default preflight and ensure defaults are safe for every actual migration creator; (3) transaction-bound the reviewed 230/300/310 execution to prevent partial privilege windows; (4) revoke direct billing access from PUBLIC/anon/authenticated and replace `ALL` service_role grants with API-justified privileges where regression-tested; (5) explicitly revoke PUBLIC/anon/authenticated EXECUTE on the billing identity trigger function; (6) verify helper owners/paths and public-schema CREATE ACL; (7) resolve no-policy tables against their real server-side access paths; and (8) test effective access and tenant boundaries on disposable PostgreSQL 17. Recommendations only: no Production permission or migration was changed and no write script was prepared.

### Disposable PostgreSQL 17 validation plan

Use an isolated disposable Supabase-compatible PostgreSQL 17 instance, not a Production clone containing customer rows. Seed synthetic `anon`, `authenticated`, `service_role`, an `auth.uid()` stub, `extensions.uuid_generate_v4()`, and the exact relevant base schemas. Reproduce reported broad public-schema defaults for each identified migration creator; document object ownership and active role. Apply the complete chronological chain from a clean baseline; do not skip to billing or mark versions applied. Test 311300's preflight with safe and unsafe global-default fixtures and inspect defaults for every possible creator.

For billing, verify after 230 that anon/authenticated/PUBLIC have no effective table access, service_role has only reviewed operations, no sequence exists, and RLS/policies match source. Confirm new function default ACL is neutralized by per-function revokes; include the `protect_billing_payment_identity()` ACL correction in a test branch. Apply 300, 310, 311700, 311800 in dependency order with transaction boundaries and force mid-script failures to confirm rollback. Verify exact RPC signatures/definitions/owners/paths, default ACLs and triggers; test entitlement states and mismatched organization IDs with synthetic fixtures, plus negative anon/authenticated and cross-tenant accesses. Discard the instance after retaining logs without fixture PII or secrets.
