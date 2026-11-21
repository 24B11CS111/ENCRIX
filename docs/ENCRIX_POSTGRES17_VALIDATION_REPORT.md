# ENCRIX disposable PostgreSQL 17 validation report

**Date:** 2026-11-05  
**Server:** PostgreSQL 17.11, Windows x86_64  
**Scope:** candidate migrations `230`, `300`, `310`, `311700`, `311800`; optional pilot `411`.  
**Isolation:** fresh temporary cluster under the task's OS temp directory on port 55439. The separately installed/running PostgreSQL Windows service was not contacted. No Production or staging connection occurred.

## Executive result

The clean synthetic candidate sequence executed successfully in PostgreSQL 17.11. That is a **DDL/functional pass only**. The candidate chain does **not pass the requested security acceptance** and no SQL has been placed in the validated-candidate directory. Source-level blockers were observed:

1. Migration `20261023000000` grants `ALL` table privileges to `service_role`, including direct payment INSERT/UPDATE/DELETE/TRUNCATE; this defeats the “payment writes through the verified RPC only” privilege boundary.
2. Migration `20261031000000` creates `protect_billing_payment_identity()` without revoking its default EXECUTE grants. With the simulated broad defaults, `PUBLIC`, `anon`, and `authenticated` all have EXECUTE.
3. Migration `20261030000000` uses `CREATE UNIQUE INDEX IF NOT EXISTS`; a same-name but wrong index definition is silently skipped and the migration exits successfully.
4. Migrations 230, 300, and 310 have no explicit transaction in source. Raw failures leave partial schema changes. `psql --single-transaction` rolled tested failure cases back completely; any eventual candidate artifact must preserve that boundary and be tested with the actual migration runner.
5. The simulated broad default ACLs remain broad after this candidate chain. Per-object revokes mitigate several created objects but do not secure future objects; creator-role/default ACL remediation remains a prerequisite.

## Disposable environment and fixture

PostgreSQL 17.11 binaries (`initdb`, `postgres`, `pg_ctl`, `psql`) were present. The existing PostgreSQL 17 Windows service was reported running, but its data directory could not be verified as disposable, so it was not used. `initdb`/`pg_ctl` could not create Windows restricted process tokens in the sandbox; a separate cluster initialized by `initdb` was started as a hidden process using `postgres.exe` directly. It was stopped and its unique temp cluster removed after testing.

The fixture created synthetic roles `postgres` (migration owner/superuser), `anon`, `authenticated`, and `service_role BYPASSRLS`; `extensions.uuid_generate_v4()`, a minimal `auth.uid()` stub; RLS-enabled organizations, profiles, and pending-registration tables; and two synthetic organizations with one owner and one telecaller each plus one active synthetic ADMIN. Broad `postgres`-creator public-schema defaults were installed for anon/authenticated tables, sequences, and functions. No real customer data or credentials were used.

The fixture models only the prerequisites needed by the candidate chain. It is not the complete production schema or the full 34-migration chronological history, and it does not establish the correctness of the earlier security migrations.

## Candidate migration outcomes

| Candidate | Clean sequence result | Security/robustness result | Final status |
|---|---|---|---|
| `20261023000000_billing_foundation.sql` | Applied successfully; all 3 billing tables, indexes, RLS and service-role policies created. | Anon/authenticated had no effective table privileges after explicit revokes. `service_role` had SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all three tables. Raw mid-migration failure after first table left `organization_subscriptions`; the `--single-transaction` copy rolled it all back. Missing `organizations` failed before any billing table remained. | **FAIL — security privilege scope and source transaction boundary.** |
| `20261030000000_owner_business_billing_details.sql` | Applied successfully on duplicate-free fixture; business columns and both indexes created. | Duplicate normalized profile email failed after columns were added. Duplicate organization owner failed after columns and profile index were added. `--single-transaction` rolled back the duplicate-email case completely. A wrong preexisting `profiles_email_unique_lower` index on `profiles(id)` was silently skipped; migration exited 0 and left the incorrect definition. | **FAIL — silent same-name index conflict; source transaction boundary.** |
| `20261031000000_onboarding_billing_integrity.sql` | Applied successfully after 230/300. Registration table/functions and payment-identity trigger created. | With broad defaults, `protect_billing_payment_identity()` had PUBLIC/anon/authenticated/service_role EXECUTE. With billing prerequisites missing, raw execution left registration table and RPCs before failing on the billing trigger. `--single-transaction` rolled back the tested missing-billing case completely. | **FAIL — trigger-function ACL and source transaction boundary.** |
| `20261031170000_razorpay_atomic_subscription_lifecycle.sql` | Applied successfully; refund fields/constraints/index and atomic payment RPC created. | SECURITY DEFINER RPC had `search_path=pg_catalog, pg_temp`, service_role EXECUTE only. Invalid existing refund data caused the constraint check to fail; the explicit transaction rolled back the new total-count column/constraint while preserving the preexisting synthetic invalid row. | **PASS functionally/transactionally; chain security remains blocked by 230 direct service-role table writes.** |
| `20261031180000_paid_subscription_entitlement_gate.sql` | Applied successfully; entitlement RPC created. | SECURITY DEFINER, fixed `pg_catalog, pg_temp`, service_role EXECUTE only. A conflicting same-signature function caused failure inside its transaction and remained unchanged. | **PASS individually; chain security remains blocked by upstream 230.** |
| `20261104120000_founding_pilot_entitlements.sql` (optional, tested separately after 311800) | Applied successfully. | Service role could not directly select pilot table but could call the service-only RPC. Active ADMIN actor accepted; non-admin actor rejected. Pilot entitlement granted access until expiry, expired access returned false, and explicit revocation returned false afterward. The migration's RPC bodies insert audit events; event row counts were not separately queried in this run. | **PASS for tested database behavior; optional and not needed for paid entitlement.** |

## Security check results

- **Direct anon billing table privileges:** PASS. Effective SELECT/INSERT/UPDATE/DELETE/TRUNCATE false on all 3 billing tables after 230.
- **Direct authenticated billing table privileges:** PASS. Same effective privileges false.
- **Service-role least privilege:** FAIL. `ALL` includes unneeded mutation and table-control privileges. Current API usage supports subscriptions and webhook events SELECT/INSERT/UPDATE; payments direct SELECT, with writes via the payment RPC.
- **Verified payment RPC execution:** PASS as a functional path. Calling the RPC as `service_role` with a synthetic verified captured payment activated only the matching organization. **RPC-only write enforcement: FAIL** because service_role also had direct payment write privileges.
- **Security-definer RPC paths/EXECUTE:** PASS for registration, payment, paid-entitlement, and pilot RPCs tested: fixed `pg_catalog, pg_temp`, service_role-only execution.
- **Payment trigger function public execute:** FAIL. `protect_billing_payment_identity()` inherited EXECUTE for PUBLIC, anon and authenticated under the fixture defaults. Its trigger-only return type limits ordinary invocation, but the ACL is still broader than necessary.
- **Cross-organization payment RPC:** PASS. A validly shaped request pairing organization 2 with organization 1's local subscription was rejected with the migration's identity-mismatch check. The initial test used a deliberately malformed synthetic payment ID and failed input validation; the corrected valid-format test reached and passed the tenant-boundary assertion.
- **Paid entitlement organization scope:** PASS in synthetic data. Active verified payment returned true only for its organization; another organization returned false. An expired period returned false.
- **Pilot time limit/revocation:** PASS. A short-lived grant expired; a separate active grant was revoked and entitlement immediately returned false. A non-admin actor was rejected.
- **Broad defaults:** FAIL as a future-object safety control. The fixture's default ACLs for public tables/sequences to anon/authenticated and function EXECUTE remained after the candidate sequence. Explicit per-object revokes protected the tested billing tables and named RPCs, except the trigger function. The chain does not include or prove successful application of migration 311300.

## Failure and rollback observations

| Scenario | Raw source behavior | Transaction-bounded behavior |
|---|---|---|
| 230, missing organizations prerequisite | Fails creating the first FK-bearing table; no billing table remains. | N/A; no partial object observed. |
| 230, preexisting conflicting `billing_payments` relation | Fails at that relation after creating `organization_subscriptions` and its indexes; partial objects remain. | Not separately repeated with this conflict; injected mid-migration error confirmed a transaction wrapper rolls the first table back. |
| 230, injected error after first table | Leaves `organization_subscriptions` behind. | `psql --single-transaction` leaves no first table. |
| 300, duplicate normalized profile email | Leaves all preceding business columns; unique index creation fails. | Leaves no business columns or index in the tested wrapped run. |
| 300, duplicate owner ID | Leaves business columns and profile email index; owner index creation fails. | Not separately repeated; same source has no explicit transaction. |
| 300, wrong same-name index | Exits successfully while retaining wrong `profiles_email_unique_lower` definition. | Transaction wrapping does not fix semantic conflict; definition validation is needed. |
| 310, billing tables missing | Leaves registration attempts table and several RPCs, then fails creating trigger on missing billing table. | `psql --single-transaction` leaves neither the table nor RPC. |
| 311700, invalid refund constraint data | Fails adding the check constraint. | Explicit migration transaction rolls back its changes; earlier fixture row remains. |
| 311800, conflicting entitlement signature | Fails at `CREATE FUNCTION`; existing conflicting body/ACL remain unchanged. | Explicit transaction prevents migration changes. |

Not tested: injected failure after an intermediate successful statement in 311800 or 411, production migration-runner transaction semantics, full chronological execution of all 34 migrations, or every existing-object conflict shape. These remain staging validation items.

## Required source corrections before candidate scripts

1. Narrow 230's service-role table privileges to API-required operations. `billing_payments` should be directly SELECT-only; its write path should remain the service-role-only SECURITY DEFINER RPC. Keep anon/authenticated/PUBLIC direct access revoked. Verify all call sites before preparing a candidate.
2. Add explicit EXECUTE revokes from PUBLIC, anon, authenticated on `protect_billing_payment_identity()` (no application role needs to invoke a trigger function directly).
3. Add a preflight that validates the exact unique index definitions and uniqueness/validity when a same-name index already exists in 300; fail closed on mismatch rather than `IF NOT EXISTS` silently accepting it.
4. Transaction-bound 230/300/310 execution artifacts. Preserve exact source DDL/function bodies and grants except for separately reviewed corrections. Validate rollback under the intended runner.
5. Reconcile defaults for every object-creator role and the 311300 global-default preflight. A role-specific/schema-specific default change is not a universal fix; public function default EXECUTE needs per-function revokes.

The candidate folder [`docs/sql/validated_candidate_migrations/`](sql/validated_candidate_migrations/) intentionally contains only a README and no executable SQL because the chain did not pass all security gates.

## Validation evidence and limits

All SQL was executed only against the new temporary PostgreSQL 17.11 cluster. The clean five-migration candidate chain completed. The pilot migration was applied separately and its positive/negative behaviors were exercised. No Production/staging connection, migration-history write, email OTP change, application-code change, deployment, payment-provider call, or real customer data use occurred. Tests were run through `psql` with `ON_ERROR_STOP`; expected failure scenarios intentionally returned nonzero and were followed by catalog-state checks.

No candidate SQL is approved for Production. After source corrections, repeat the entire suite in disposable Supabase-compatible PostgreSQL 17 with actual Supabase roles/extensions/auth functions and a safe clone of relevant ACL defaults, then re-run all preflight/postflight checks before seeking any Production-write approval.
