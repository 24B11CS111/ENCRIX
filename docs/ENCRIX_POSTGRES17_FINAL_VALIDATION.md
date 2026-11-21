# ENCRIX PostgreSQL 17.11 Final Billing Migration Validation

Date: 2026-11-05

## Environment and scope

A fresh, isolated PostgreSQL 17.11 cluster was initialized under the operating-system temporary directory and bound only to `127.0.0.1` on port `55441`. All fixture records were synthetic. Roles included `postgres`, `anon`, `authenticated`, `service_role`, and a separate `migration_runner`. Two organizations with owner and telecaller profiles were used. Synthetic broad public-schema default privileges were installed for the object creators. No Production or staging endpoint was used.

The validated sequence was the five billing candidates in `docs/sql/validated_candidate_migrations/`, in filename order. The base fixture represented the required existing core schema and UUID extension. This is not a run of all repository migrations or proof that Production currently matches the fixture.

## Results

| Area | Result | Evidence |
|---|---|---|
| Full five-migration chain under `postgres` | PASS | All five candidates committed in dependency order. |
| Full chain under separate `migration_runner` with broad defaults | PASS | All five candidates committed; object grants remained least privilege. |
| Anon/authenticated direct billing access | PASS | No direct SELECT/INSERT/UPDATE/DELETE/TRUNCATE on billing relations. |
| Service-role table grants | PASS | Subscriptions and webhook events: SELECT/INSERT/UPDATE only. Payments: SELECT only. No DELETE/TRUNCATE. |
| Payment write route | PASS | Direct service-role payment INSERT and UPDATE were denied; verified payment RPC succeeded, including its repeat/update path. |
| Payment validation and tenant boundary | PASS | Invalid amount and mismatched organization/payment attempt rejected; valid payment accepted for its organization only. |
| Entitlement expiration | PASS | Paid organization was entitled while current; expired period was rejected; second organization remained unentitled. |
| Trigger-only function | PASS | Direct EXECUTE denied to PUBLIC/anon/authenticated/service_role; trigger remained enabled and fired on payment update, rejecting identity mutation. |
| Function security | PASS | Payment lifecycle and entitlement SECURITY DEFINER functions use fixed `pg_catalog, pg_temp` search path and service-role execution grant. |
| Correct same-name indexes | PASS | Exact normalized-email partial unique index and owner-id unique index accepted. |
| Incorrect same-name indexes | PASS | Wrong/nonunique, wrong predicate, and wrong target-index scenarios failed closed before column alterations; conflicting indexes remained unchanged. |
| Duplicate data | PASS | Duplicate normalized emails and duplicate owner IDs caused migration failure and transaction rollback. |
| Missing prerequisites | PASS | Missing core/billing prerequisite caused failure; no partial target objects remained. |
| Conflicting objects | PASS | Conflicting table/function cases failed without replacing the preexisting conflicting object; earlier statements in the candidate transaction rolled back. |
| Invalid constraint fixture | PASS | Lifecycle candidate failed on invalid refund constraint; its transaction rolled back its changes and preserved the synthetic row. |
| Mid-migration failure | PASS | Injected failure after initial DDL left no partial objects for the tested atomic migrations. |
| Repository regression tests | PASS | `npm test -- --maxWorkers=2 src/test/billing_security_candidate_migrations.test.ts src/test/billing_preflight_contract.test.ts`: 2 files, 19 tests passed. |
| TypeScript | PASS | `npx tsc --noEmit` exited 0. |
| Whitespace validation | PASS | `git diff --check` exited 0 (Git emitted only existing LF-to-CRLF advisory warnings). |

## Candidate status

| Version | Candidate status | Notes |
|---|---|---|
| 20261023000000 | PASS | Narrow service-role ACLs; explicit transaction. |
| 20261030000000 | PASS | Transaction and exact index preflight. |
| 20261031000000 | PASS | Transaction and trigger-function EXECUTE revocation. |
| 20261031170000 | PASS | Full lifecycle candidate succeeded; failure injection rolled back. |
| 20261031180000 | PASS | Entitlement gate succeeded; conflicting function failed closed. |
| 20261104120000 founding pilot | NOT TESTED / OUT OF SCOPE | Optional pilot migration was not applied and no pilot grant was created. |
| Original full repository migration history | NOT TESTED | Only the requested proposed five-migration chain was applied to a synthetic base fixture. |

## Default privilege and ownership limits

The repository scan found default-privilege edits only in `20261031130000_public_leads_privilege_hardening.sql`; they are schema- and role-specific to `postgres`, not global. The disposable run demonstrated that the explicit candidate ACLs work when either `postgres` or `migration_runner` has broad schema defaults. It did not establish Production's migration executor, global/schema default ACLs, or object owner. Those must be inspected read-only in Production before preparing final execution approval.

## Production gate and recovery

Before requesting Production write approval:

1. Run the current read-only table/column/index/constraint/function/RLS/trigger/ACL/history preflights against Production.
2. Confirm the exact Production migration executor and object creator roles, `current_user`/ownership, global and schema-specific default ACLs, and effective grants.
3. Resolve any preexisting same-name object or history mismatch. Never treat `NOT_RECORDED` as proof of absence; reconcile catalog state and source definitions first.
4. Back up and export affected data, preserve a recovery copy, and document a tested rollback/recovery plan with the Production DBA.
5. Review each candidate independently against the live preflight, then obtain explicit approval before any Production SQL execution. Apply one migration at a time and run its postflight before continuing.
6. Keep checkout and pilot grants disabled; do not apply the optional pilot migration in this sequence.

The temporary PostgreSQL 17.11 instance was stopped after validation. No Production migration approval package has been authorized by these local tests.
