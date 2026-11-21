# ENCRIX database and migration reconciliation

**Prepared:** 2026-11-04. **No production/staging query or SQL execution was performed in this audit.**

## Evidence boundary and known blockers

The repository contains **33** ordered migration files (`20261001000000` through `20261101100000`). Existing project audit notes record the following as requester/operator supplied, not independently re-queried facts: versions `20261001000000` and `20261001000001` are recorded in production; 31 later versions are unrecorded; `public.organization_subscriptions`, `public.billing_payments`, and `public.organization_has_active_paid_entitlement(uuid)` were reported missing. All other production object states are **UNKNOWN**. A missing history row does not prove the corresponding DDL is absent.

The exact OTP error can arise when the deployed application requires `email_otps.ticket_id`, `verified_at`, or `issue_email_otp_ticket` / `complete_email_otp_verification` / `cancel_email_otp_ticket` but production lacks a compatible object or service-role grant. That is the leading source-level explanation, not a verified production diagnosis. Migration `20261031150000_durable_email_otp_attempts.sql` is source-only until catalog output proves otherwise.

## Reconciliation inventory

The existing [production schema reconciliation inventory](production-schema-reconciliation.md) enumerates all 33 migration versions, expected objects, dependencies, risks, and the 31 reported unrecorded states. Its exhaustive per-migration effect table is the source map for this report. Summary order and release gates:

| Order | Version range | Expected changes and dependencies | Production state / risk |
|---:|---|---|---|
| 1 | `20261001000000`–`20261001000001` | Base tenant/CRM schema, auth helpers, initial RLS and security hardening. | Reported recorded; actual definitions still require catalog comparison. Critical foundation. |
| 2 | `20261006000000`–`20261008000000` | Call recordings/webhook state, phone OTP/onboarding/invitations, email fields and `email_otps`. | Reported unrecorded. High; prerequisite for durable email OTP. |
| 3 | `20261012000000`–`20261022000000` | Realtime, sanitized lead/student projections, distribution, follow-ups, profile/lead security and RLS hardening. | Reported unrecorded; all schema state unknown. Critical security behavior. |
| 4 | `20261023000000`–`20261024130000` | Billing foundation, caller enrollment/call bridges, secure telecaller access. | Reported unrecorded; two billing tables specifically reported missing. High/critical. |
| 5 | `20261027000000`–`20261031140000` | Realtime publication and notification updates, business billing fields, CSV persistence, owner registration transaction, sanitized realtime signals, lead ACL/search-path hardening. | Reported unrecorded; inspect exact publication columns, defaults, constraints, functions, and data conflicts. High/critical. |
| 6 | `20261031150000` | Durable email OTP ticket metadata, unique ticket index, issue/complete/cancel RPCs and service-role-only grants. | Reported unrecorded; directly relevant OTP release blocker. **Do not apply until preflight/state comparison and explicit approved release process.** |
| 7 | `20261031160000` | Per-organization encrypted Twilio credentials, inbound attempts, call bridge state/indexes and service-role RPCs. | Reported unrecorded; high risk. Depends on caller bridge, calls, leads, profiles. |
| 8 | `20261031170000`–`20261031180000` | Atomic Razorpay payment/subscription lifecycle and paid-entitlement RPC. | Reported unrecorded; core billing objects were reported missing. High/critical. |
| 9 | `20261101090000`–`20261101100000` | Follow-up email outbox and unique pending invitation constraint. | Reported unrecorded; inspect duplicates and FK semantics before applying. High. |

**Per migration:** expected DDL is derived from source only; exact actual object set is **UNKNOWN** except the supplied absences above. The full inventory provides all filenames, effects, dependencies, and individual risk notes. Do not infer that any entire migration is safely applicable from its history status alone.

## Safe reconciliation procedure

1. Confirm target project identity independently and capture a restorable backup/restore procedure.
2. Run `supabase/tests/diagnose_all_production_migrations.sql` and the specialized diagnostics in `supabase/tests/` as read-only queries. Retain full catalog results without customer row values or secrets.
3. For every migration, compare object definitions, not names alone: columns/types/defaults/constraints/index predicates, function signatures/bodies/owners/search paths/ACLs, trigger definitions, RLS flags/policies, table/column/default ACLs, publication membership/columns, and migration history.
4. Review all `CONFLICTING` and `UNKNOWN` results and data-compatibility aggregate checks. Determine whether a version needs a migration, a verified history baseline, or separate reviewed remediation. Never fabricate history.
5. Build a version-by-version staging sequence respecting dependencies and transaction/lock characteristics. Review every SQL test's fixture and rollback behavior before use.
6. Apply only under a separate approved change plan. Do not run `supabase db push`, replay all migrations, or execute the OTP repair SQL during this audit.
7. Verify post-apply catalog definitions, grants, RLS, RPC behavior, history, and isolated end-to-end workflows before release.

## Migration execution status

No production database/schema was modified. The durable OTP preflight/source review and repair SQL are present locally, but no execution is represented as complete. No migration-history rows were inserted. No SQL test was executed against PostgreSQL during this audit. The existing [database release audit](ENCRIX_DATABASE_RELEASE_AUDIT.md) also records that a prior disposable database attempt was blocked by Docker Engine unavailability; that historical observation must be rechecked before the next attempt.
