# ENCRIX Production Billing Migration Recovery Review

**Review date:** 2026-11-01
**Scope:** Source-only review of repository migrations and production facts supplied for this task. No production connection or SQL execution was performed.

## Decision

**BLOCKED for production execution.** Do not run `supabase db push`, apply only the four billing migrations, or repair migration history yet.

The supplied production history contains only `20261001000000` and `20261001000001`, while this repository contains 33 migration files. Therefore 31 local versions appear unrecorded. The supplied production facts confirm that `public.organization_subscriptions`, `public.billing_payments`, and `public.organization_has_active_paid_entitlement(uuid)` are absent. They do not establish the actual state of the other 31 migrations' objects, the third billing table `billing_webhook_events`, prerequisites, extensions, grants, or data constraints. Missing migration history is not proof that a migration's effects are absent.

Before any write, reconcile all 31 versions individually against production catalogs and data. Baseline a version only after its complete effects have been verified. Apply only versions whose effects are genuinely absent, in dependency order, after a database backup and a reviewed per-migration preflight.

## Confirmed inputs versus unknowns

### Inputs supplied by the requester

- Production migration history reports `20261001000000` and `20261001000001` only.
- The four versions called out below have no migration history rows.
- Production lacks `public.organization_subscriptions`, `public.billing_payments`, and `public.organization_has_active_paid_entitlement(uuid)`.

These production facts were not independently queried in this review.

### Not established by the supplied evidence

- Whether any of the 31 unrecorded migrations are already applied in substance.
- Whether `public.billing_webhook_events` already exists or conflicts with migration 230000.
- Whether the required `public.organizations`, `public.profiles`, `public.pending_registrations`, UUID extension, Supabase roles, and all intermediate schema objects match repository definitions.
- Whether there are duplicate or incompatible rows/objects relevant to constraints, indexes, functions, policies, or triggers.
- Which database role the production migration executor uses and its effective/default ACLs.

## Migration inventory and chronological plan

The local directory contains 33 migration files. Given the supplied history, the following 31 versions are unrecorded. This is the repository chronology, **not authorization to apply them**:

1. `supabase/migrations/20261006000000_production_telephony_recordings.sql`
2. `supabase/migrations/20261007000000_otp_authentication_and_onboarding.sql`
3. `supabase/migrations/20261008000000_email_otp_authentication.sql`
4. `supabase/migrations/20261012000000_phase17_realtime_crm_telephony.sql`
5. `supabase/migrations/20261013000000_phase18_secure_student_details_zero_phone.sql`
6. `supabase/migrations/20261014000000_phase20_smart_lead_distribution.sql`
7. `supabase/migrations/20261015000000_phase21_smart_follow_up_engine.sql`
8. `supabase/migrations/20261018000000_phase22_security_critical_remediation.sql`
9. `supabase/migrations/20261019000000_phase22_phone_exposure_remediation.sql`
10. `supabase/migrations/20261020000000_phase23_followup_reminder_concurrency.sql`
11. `supabase/migrations/20261021000000_phase23_7_production_blocker_remediation.sql`
12. `supabase/migrations/20261022000000_phase23_8_active_profile_rls.sql`
13. `supabase/migrations/20261023000000_billing_foundation.sql` **(billing target)**
14. `supabase/migrations/20261023120000_secure_caller_enrollment_bridge_persistence.sql`
15. `supabase/migrations/20261024100000_phase24_1_security_remediation.sql`
16. `supabase/migrations/20261024120000_phase24_3_secure_telecaller_lead_access.sql`
17. `supabase/migrations/20261024130000_phase24_7_server_telecaller_leads.sql`
18. `supabase/migrations/20261027000000_phase32_realtime_publications.sql`
19. `supabase/migrations/20261028000000_phase33_realtime_notifications.sql`
20. `supabase/migrations/20261030000000_owner_business_billing_details.sql`
21. `supabase/migrations/20261030120000_owner_csv_import_persistence.sql`
22. `supabase/migrations/20261031000000_onboarding_billing_integrity.sql` **(billing target and registration/security migration)**
23. `supabase/migrations/20261031120000_sanitized_lead_refresh_signals.sql`
24. `supabase/migrations/20261031130000_public_leads_privilege_hardening.sql`
25. `supabase/migrations/20261031140000_security_definer_search_path_hardening.sql`
26. `supabase/migrations/20261031150000_durable_email_otp_attempts.sql`
27. `supabase/migrations/20261031160000_organization_twilio_calling.sql`
28. `supabase/migrations/20261031170000_razorpay_atomic_subscription_lifecycle.sql` **(billing target)**
29. `supabase/migrations/20261031180000_paid_subscription_entitlement_gate.sql` **(billing target)**
30. `supabase/migrations/20261101090000_followup_email_outbox.sql`
31. `supabase/migrations/20261101100000_unique_pending_invitations.sql`

The confirmed history entries correspond to `20261001000000_init_leadvault.sql` and `20261001000001_security_hardening.sql`. The next section describes the four billing migrations' source effects; it does not classify the other 27 migrations as safe to replay or baseline.

## Four billing migration effects and dependencies

### 1. `20261023000000_billing_foundation.sql`

**Creates**

- `public.organization_subscriptions`: UUID primary key; organization FK with `ON DELETE RESTRICT`; plan/status/entitlement-source checks; current-subscription flag; unique checkout idempotency key; checkout-creation status; amount and Razorpay identifiers; period/cancellation/end/payment timestamps; period ordering check; unique `(id, organization_id)` constraint.
- `public.billing_payments`: UUID primary key; organization FK with `ON DELETE RESTRICT`; nullable-at-creation `subscription_id`; provider/idempotency/payment identifiers; positive amount and INR checks; status check; signature/paid/failed timestamps; composite organization/subscription FK with `ON DELETE RESTRICT`.
- `public.billing_webhook_events`: UUID primary key; provider/event identity; event type; SHA-256 payload digest check; processing state and timestamps; unique `(provider, provider_event_id)` constraint.
- Indexes: `organization_subscriptions_one_current_per_org` (unique partial index on `organization_id WHERE is_current`), `organization_subscriptions_status_period_end`, `billing_payments_org_created`, `billing_payments_subscription_created`.

**Changes security**

- Enables RLS on all three tables.
- Revokes all table privileges from `PUBLIC`, `anon`, and `authenticated`.
- Grants all table privileges to `service_role` and adds one service-role `FOR ALL` policy per table.
- Creates no functions, triggers, or schema grants.

**Dependencies and risks**

- Requires `public.organizations`, `extensions.uuid_generate_v4()`, and the Supabase roles.
- Migration creates tables and indexes without `IF NOT EXISTS`; a same-name existing object causes failure. `billing_webhook_events` status is unknown from the supplied facts.
- Production org data is referenced by an FK, but the migration does not backfill subscriptions or charge customers.

### 2. `20261031000000_onboarding_billing_integrity.sql`

**Creates/alters data structures**

- Creates `public.registration_otp_attempts` if absent with ticket UUID primary key, email/hash, 0–5 attempt check, verification/consumption, and expiry.
- Adds `otp_hash` and `verified_at` to that table when missing, and adds `otp_ticket_id` to `public.pending_registrations` when missing.
- Enables RLS, revokes direct table access, and creates/replaces the service-role-only policy on `registration_otp_attempts`.
- Adds validated checks if missing: `organization_subscriptions_amount_required`, `billing_payments_subscription_required`, and `billing_payments_status_timestamps`.

**Creates/replaces/drops functions and trigger**

- Replaces: `issue_registration_otp_ticket(...)`, `get_registration_otp_attempts(uuid,text)`, `complete_registration_otp_verification(uuid,text,boolean)`, `cancel_registration_otp_ticket(uuid,text)`, `create_owner_registration(...)`, and `protect_billing_payment_identity()`.
- Drops legacy `record_registration_otp_failure(uuid,text)` if present.
- Drops and recreates `protect_billing_payment_identity` trigger on `billing_payments`.
- Revokes function execution from `PUBLIC`, `anon`, and `authenticated`; grants these OTP/registration RPCs to `service_role`.
- The payment trigger prevents organization/subscription identity changes, invalid payment-state reversals, and loss of captured-payment verification timestamps.

**Dependencies and risks**

- Explicitly follows `20261030000000_owner_business_billing_details.sql`; that migration adds business fields and case-insensitive profile-email/organization-owner indexes. It in turn depends on `pending_registrations` from 070000 and the base organization/profile tables.
- Requires billing foundation tables from 230000 and registration/profile tables from earlier migrations.
- `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` do not prove existing objects are compatible. Named constraints scan existing rows and can fail. Existing OTP/registration state must be preserved and inspected; no automatic data cleanup is included.
- This is broader than billing: it changes owner registration and OTP behavior and intentionally removes a legacy failure RPC.

### 3. `20261031170000_razorpay_atomic_subscription_lifecycle.sql`

**Creates/alters data structures**

- Adds `billing_payments.amount_refunded_paise BIGINT NOT NULL DEFAULT 0` if absent.
- Adds `organization_subscriptions.razorpay_total_count INTEGER` if absent.
- Adds validated checks: `billing_payments_refund_amount_valid`, `organization_subscriptions_total_count_positive`, `billing_payments_refund_status_valid`.
- Creates `billing_payments_verified_subscription_period` on `(subscription_id, paid_at)` filtered to captured, signature-verified payments.
- No table, trigger, or RLS-policy creation. It modifies no existing policy definitions.

**Creates/replaces RPC and grants**

- Replaces `public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamptz,bigint,integer,text,timestamptz,timestamptz,timestamptz) RETURNS jsonb`, a `SECURITY DEFINER` PL/pgSQL function with `search_path = pg_catalog, pg_temp`.
- RPC validates provider/payment identifiers, amount/currency/status/refund bounds, local subscription identity and plan amount; atomically persists payment state and updates subscription lifecycle.
- Revokes execution from `PUBLIC`, `anon`, and `authenticated`; grants execution to `service_role`.

**Dependencies and risks**

- Source explicitly requires 230000 and 310000.
- Preflights require compatible types and validate existing refund amounts/statuses, positive total counts, and named check constraints. Invalid legacy rows or same-name index conflicts block application.
- The migration contains its own `BEGIN`/`COMMIT`; do not wrap it in a runner that allows an inner `COMMIT` to escape an intended outer transaction.

### 4. `20261031180000_paid_subscription_entitlement_gate.sql`

**Creates and secures RPC**

- Creates `public.organization_has_active_paid_entitlement(uuid) RETURNS boolean`, SQL `STABLE SECURITY DEFINER`, with `search_path = pg_catalog, pg_temp`.
- It grants access only for a current, in-period, active Business subscription at 999900 paise, tied to a matching Razorpay payment that is captured, INR, signature-verified, paid within the current period, and not fully refunded.
- Revokes execution from `PUBLIC`, `anon`, and `authenticated`; grants only `service_role`.
- Creates/alters no tables, indexes, triggers, policies, or data.

**Dependencies and risks**

- Requires the billing foundation, 310000 payment constraints, and 170000 refund field. A migration-history entry alone is insufficient; verify the exact function body, owner, security metadata, search path, and effective/stored execute ACLs.
- Production function absence is confirmed by the supplied facts, but all prerequisite columns and grants remain unverified.

## Intermediate migration implications

The 27 other unrecorded versions are not incidental. They include OTP/authentication and profile-status changes (070/080/220/311500), lead/call access and security changes (120–241300, 301200, 311300–311400), reminder changes (150/200/210/20261101090000), Realtime publication changes (270/280/311200), onboarding uniqueness/business fields (300/20261101100000), and Twilio database/security work (231200/311600). Some are direct prerequisites for migration 310; others change shared functions, triggers, grants, RLS, or publication membership. Their production state is unknown, so neither replay nor baseline is approved by this review.

## Safe recovery sequence for manual review

1. Confirm the exact production Supabase project independently. Capture a recoverable backup/PITR checkpoint and verify restoration access before any write.
2. Run read-only catalog and data preflights for **all 31 unrecorded versions** in chronological order. Compare tables, columns, indexes, constraints, functions/bodies, owners, SECURITY DEFINER/search paths, triggers, policies, grants/default ACLs, extensions, and Realtime publication membership with each source migration.
3. For each version, classify `missing`, `partially applied`, `applied in substance`, or `conflicting`. Resolve ambiguous/conflicting state manually; do not clean or rewrite customer data automatically. Baseline only individually proven complete effects under a separately approved history procedure.
4. Review 230000 prerequisites and all three target table names. If effects are entirely absent and dependencies match, apply 230000 first through an approved transactional procedure; verify tables, constraints, indexes, RLS, stored/effective grants, and service-role access.
5. Verify/complete earlier dependencies, especially 070000 and 300000, before considering 310000. Preflight existing OTP rows and all three billing checks. Review the function/trigger changes because this migration also changes registration security. Apply only after its own approval; verify each effect.
6. Apply/verify intervening migrations in dependency and chronological order. Do not skip them merely because they are not billing-named; each requires its own replay-safety determination.
7. Apply 311700 only after 230000 and 310000 effects are verified. Check existing refund/total-count values, constraint compatibility, index name/definition, function signature/body/owner, and grants. Respect its explicit transaction boundaries.
8. Apply 311800 only after 311700's columns and constraints are confirmed. Verify the entitlement predicate and that API roles cannot execute it directly while `service_role` can.
9. After each approved migration or history-only baseline, verify its exact catalog effects and exactly one history record before proceeding. Keep Razorpay checkout disabled until the database and provider Test Mode plan are independently verified.

## Backup and rollback requirements

- Take a Supabase-supported backup/PITR point and preserve a schema/catalog snapshot plus migration history before rollout. Verify the recovery method on a non-production copy.
- Execute one reviewed migration at a time with error-stop behavior and a transaction where the migration permits it. Do not combine a set of pending files into one unreviewed push.
- These migrations do not include a safe general-purpose down migration. Do not automatically drop billing/OTP tables, columns, constraints, or functions after they have received live data or application traffic. Prefer a forward corrective migration; restore from backup only through an approved incident-recovery plan.
- Migration 310 removes a legacy OTP failure function and changes payment trigger behavior; rollback could weaken security or break active application code. Migration 170 changes payment/refund state atomically; dropping its columns or RPC could lose audit/state data or break webhooks. Migration 180 rollback would make paid operations fail closed and requires coordinated application behavior.

## Final assessment

| Migration | Source-level assessment | Production execution status |
|---|---|---|
| 230000 billing foundation | Additive schema and restrictive service-role-only access; no billing tables are reported in production. | **REVIEW / BLOCKED** until prerequisites, `billing_webhook_events`, role/extension state, and other unrecorded migrations are reconciled. |
| 310000 onboarding/billing integrity | Required for payment constraints, payment identity trigger, and transactional registration/OTP functions. | **BLOCKED** until 070000, 300000, 230000 and actual registration/billing state are verified. |
| 311700 Razorpay lifecycle | Required refund/plan-count integrity and atomic payment RPC; validates existing rows. | **BLOCKED** until 230000/310000 effects and data preflights pass. |
| 311800 entitlement gate | Required paid-feature authority; source function is service-role-only. | **BLOCKED** until 311700 and all exact billing dependencies are verified. |

No migration order in this document authorizes production execution. The safe next action is a full read-only production schema reconciliation for every unrecorded migration, followed by a separately reviewed, approved rollout plan.
