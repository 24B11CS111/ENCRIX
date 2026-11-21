# ENCRIX billing migration security test matrix

All tests below were run only in a fresh temporary PostgreSQL 17.11 cluster with synthetic organizations, profiles, roles, and default ACLs. No Production or staging database was accessed. See [validation report](ENCRIX_POSTGRES17_VALIDATION_REPORT.md) for fixture and failure details.

| Test | Expected outcome | Result | Evidence / notes |
|---|---|---|---|
| Apply sequence 230 → 300 → 310 → 311700 → 311800 on expected prerequisite schema | All candidate DDL/RPC definitions created | PASS | Each source migration completed on a clean synthetic fixture. |
| Anon direct access to billing tables | Denied | PASS | Effective SELECT/INSERT/UPDATE/DELETE/TRUNCATE false for each table. |
| Authenticated direct access to billing tables | Denied unless specifically designed | PASS | Effective direct table privileges all false. |
| Service-role access limited to API requirements | No unnecessary table operations | **FAIL** | Migration 230 grants ALL on every billing table, including payment write/delete/truncate. |
| Payment mutation through verified payment RPC only | Direct service-role DML denied; RPC allowed | **FAIL** | RPC succeeded; direct service-role INSERT/UPDATE/DELETE remain granted by 230. RPC-only boundary is not enforced. |
| Apply-payment RPC role/path | service_role only, SECURITY DEFINER, fixed safe path | PASS | `search_path=pg_catalog, pg_temp`; anon/authenticated/PUBLIC EXECUTE false. |
| Paid-entitlement RPC role/path | service_role only, SECURITY DEFINER, fixed safe path | PASS | `search_path=pg_catalog, pg_temp`; returns false for another org and expired period. |
| Registration RPC role/path | service_role only, SECURITY DEFINER, fixed safe path | PASS | Expected functions were created with explicit revokes and service-role grants. |
| Trigger function EXECUTE minimized | No PUBLIC/anon/authenticated direct grant | **FAIL** | `protect_billing_payment_identity()` inherited default EXECUTE for all three roles. |
| Payment trigger creation | Correct trigger exists on payments | PASS | Trigger created on clean chain; failure when billing table prerequisite is absent leaves partial state unless transaction-bounded. |
| Cross-org payment update | Organization/subscription mismatch rejected | PASS | Valid synthetic call rejected at subscription identity guard. |
| Verified payment grants entitlement | Matching org becomes active and entitled | PASS | Service-role RPC stored synthetic verified payment and paid gate returned true for that org only. |
| Expired subscription | Entitlement false | PASS | Moving the synthetic subscription period end into the past returned false. |
| Pilot actor authorization | Active ADMIN accepted; non-admin rejected | PASS | Invalid owner profile actor raised insufficient-privilege error. |
| Pilot expiration/revocation | Expired or revoked grant returns false | PASS | One-second grant expired; separate grant was revoked and no longer entitled. |
| Pilot table direct access | No direct service-role or anon table grant | PASS | Direct SELECT privilege false; service-role RPC EXECUTE true. |
| Duplicate normalized profile email during migration 300 | Migration fails without partial changes | **FAIL on raw source** | Raw migration leaves business columns; transaction-wrapped run fully rolled back. |
| Duplicate organization owner during migration 300 | Migration fails without partial changes | **FAIL on raw source** | Raw migration leaves business columns and first index. |
| Existing same-name wrong profile index | Migration must detect mismatch | **FAIL** | `IF NOT EXISTS` skipped wrong index `profiles(id)` and returned success. |
| Missing organizations prerequisite for 230 | Fail closed | PASS | First table statement failed and no billing table remained. |
| Conflicting billing_payments object during 230 | Fail without partial schema | **FAIL on raw source** | Subscription table and indexes remained after payment table conflict. |
| Missing billing prerequisite during 310 | Fail without partial schema | **FAIL on raw source** | Registration table/RPCs remained before trigger creation failed. |
| Invalid refund constraint data during 311700 | Migration rolls back completely | PASS | Explicit transaction removed attempted new column/constraint effects; fixture row remained. |
| Existing paid gate signature conflict during 311800 | No overwrite/partial migration | PASS | Existing conflict remained unchanged after transactional create failure. |
| Broad default ACL inheritance | Sensitive objects remain safe and future objects fail closed | **FAIL overall** | Table/function object-specific revokes protected many objects, but defaults remain broad; trigger function is exposed. |
| Transaction wrapper for no-BEGIN candidates | Mid-migration failure leaves no partial changes | PASS in tested cases | `psql --single-transaction` rolled back injected 230 and duplicate 300/missing-prerequisite 310 cases. Validate actual migration runner. |

## Release decision

The source sequence is not ready for Production candidate SQL. The minimum blocking corrections are: narrow service-role grants in migration 230; explicitly revoke PUBLIC/anon/authenticated EXECUTE on the billing trigger function in 310; make migration 300 validate exact same-name index definitions; transaction-bound reviewed execution copies for 230/300/310; and reconcile default ACLs for every actual migration creator. Then repeat all failing matrix rows and the full clean chain before adding any SQL under `docs/sql/validated_candidate_migrations/`.
