# ENCRIX Billing Security Remediation Report

Date: 2026-11-05

## Outcome

The five reviewed candidate migrations were executed as a complete sequence in a fresh local PostgreSQL 17.11 fixture and passed the integrated security and failure-injection checks described in [the final validation report](ENCRIX_POSTGRES17_FINAL_VALIDATION.md). The original migration sources were not changed. No Production or staging connection, SQL execution, migration-history edit, deployment, payment, or pilot grant was performed.

## Findings and fixes

1. **Billing table privileges — fixed in the candidate for `20261023000000`.** The API call-site review found direct service-role `SELECT`, `INSERT`, and `UPDATE` on `organization_subscriptions` and `billing_webhook_events`; no direct deletes. `billing_payments` is directly selected, while writes go through `apply_verified_razorpay_payment()`. Candidate ACLs revoke all from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant only those exact service-role operations. No TRUNCATE, REFERENCES, or TRIGGER privilege is granted. A service-role RLS policy does not replace this ACL restriction because service_role bypasses RLS.
2. **Trigger function EXECUTE — fixed in candidate `20261031000000`.** Direct execution on `protect_billing_payment_identity()` is revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`. PostgreSQL still invoked it through its trigger; the update-protection trigger test passed.
3. **Index definitions — fixed in candidate `20261030000000`.** Before any column changes, a fail-closed catalog guard checks existing same-name indexes for relation kind, uniqueness, validity/readiness, btree method, key/include counts, indexed key or expression, and predicate. Exact indexes pass; wrong profile or owner indexes fail and remain untouched. The migration's transaction rolls back on failure.
4. **Atomic execution — fixed in candidate copies.** Explicit `BEGIN`/`COMMIT` bounds `20261023000000`, `20261030000000`, and `20261031000000`; the two later candidates already retain their migration transaction boundaries. Injected failures were checked for rollback. Each candidate is a separate file; do not concatenate these into one blind execution.
5. **Default privileges — addressed per object.** The repository contains a `20261031130000` public-schema, `FOR ROLE postgres` default-ACL change; it does not change global defaults or defaults for a different creator. The candidate scripts do not alter defaults globally and explicitly revoke/grant on created billing tables and functions. Synthetic broad schema defaults were tested under both `postgres` and a separate `migration_runner`, and explicit object ACLs produced the intended access. Production's actual migration runner/creator, global and schema-scoped defaults, and object ownership still require a read-only Production audit before approval.

## Production-facing limitations

This validates candidate behavior against synthetic prerequisites, not the current Production schema, ACLs, migration history, data, or actual migration role. Earlier Production preflight results are historical evidence only. Do not run candidates until current read-only preflights establish exact prerequisites, same-name object definitions, data/index compatibility, creator role, and migration-history reconciliation. The candidate copies are review artifacts, not authorization to execute.

## Files

- Candidate SQL: [`docs/sql/validated_candidate_migrations/`](sql/validated_candidate_migrations/README.md)
- PostgreSQL run details: [`docs/ENCRIX_POSTGRES17_FINAL_VALIDATION.md`](ENCRIX_POSTGRES17_FINAL_VALIDATION.md)
- Regression contract: `src/test/billing_security_candidate_migrations.test.ts`
