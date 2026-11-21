# ENCRIX Production Step 4 — Index and Constraint Audit

**Status: INCOMPLETE — NO-GO.** This report records preparation of the two read-only diagnostics. Production index and constraint result sets have not been obtained.

## Target

- Supabase project: `ENCRIX`
- Project reference: `wrzoqxesffbfirjgotbr`
- Scope: PostgreSQL catalog inventory only; no migration or database operation is authorized.

## Diagnostic execution status

| Result set | Expected section | Execution status | Row count | Findings |
|---|---|---|---:|---|
| Index catalog | `INDEX_CATALOG` | Not executed; no authorized database query tool/connection available in this session | Unknown | Invalid/not-ready indexes cannot be determined |
| Constraint catalog | `CONSTRAINT_CATALOG` | Not executed; no authorized database query tool/connection available in this session | Unknown | Unvalidated/missing primary, foreign-key, unique, and check constraints cannot be determined |
| Prior source-expectation catalog | `SOURCE_EXPECTATION_CATALOG` | User reports collected previously; output not available in this session and was not rerun | Unknown here | No result claims made |

The Supabase CLI is available as a local project executable, but the CLI is not on `PATH`; previous Production catalog attempts in this audit were blocked by temporary database-role authentication. No authentication bypass or credential retry was attempted. `psql` is not available on `PATH`. No Production diagnostic was executed here.

## Prepared SQL files

- [Index catalog query](../supabase/tests/diagnose_production_index_catalog.sql) contains only the `INDEX_CATALOG` SELECT.
- [Constraint catalog query](../supabase/tests/diagnose_production_constraint_catalog.sql) contains only the `CONSTRAINT_CATALOG` SELECT.
- The existing combined [Step 4 diagnostic](../supabase/tests/diagnose_production_indexes_constraints.sql) was preserved and not rewritten for this task.

Both standalone files query PostgreSQL catalogs only. They do not select application table records or retrieve customer/lead contact details, OTP values, payment data, credentials, or secrets. Query output includes public schema names, index/constraint definitions, and catalog metadata; treat it as operational schema information.

## Inventory coverage and source comparison

The index query reports every index attached to public relations, including definitions, uniqueness, primary/exclusion flags, access method, validity/readiness, expression columns, and partial predicates.

The constraint query reports public primary key, foreign key, unique, check, and exclusion constraints; definitions, validation and deferral state; and a constraint-associated index where PostgreSQL records one. For a foreign key, PostgreSQL's `conindid` is the referenced key's supporting index, not necessarily an index on the referencing columns. The full index result is needed to review both sides.

Repository source includes, among other objects:

- Base primary keys, unique constraints, foreign keys, checks, and operational indexes in `20261001000000_init_leadvault.sql`.
- Subscription/payment/webhook constraints and billing indexes in `20261023000000_billing_foundation.sql`.
- Payment and subscription integrity checks in `20261031000000_onboarding_billing_integrity.sql` and `20261031170000_razorpay_atomic_subscription_lifecycle.sql`.
- Profile-email and organization-owner unique indexes in `20261030000000_owner_business_billing_details.sql`.
- Pending invitation uniqueness in `20261101100000_unique_pending_invitations.sql`.
- Registration OTP timestamp index in `20261105160000_registration_otp_send_rate_limit.sql`.
- Refund/cancellation foreign keys, unique/check constraints, and indexes in `20261105170000_billing_refund_cancellation_workflows.sql`.
- Refund audit index in `20261106100000_admin_refund_management.sql`.

The combined diagnostic's source-expectation CTE checks a curated subset of named billing/onboarding artifacts. Presence by name does not prove that the definition matches the migration. Full catalog definitions must be compared with the applicable source migration; an absent artifact does not establish that it is safe to create. Dependencies, existing rows, duplicate conflicts, migration history, and partial application must be reviewed before any proposed change.

## Security and data-integrity risks

- An invalid or not-ready index can affect query plans or indicate an incomplete index build; neither status can be inferred without the index result set.
- Missing, unvalidated, or definition-mismatched constraints may weaken referential integrity, uniqueness, or business invariants. No such Production finding is asserted.
- Unique indexes/constraints may be blocked by existing duplicate data. Do not delete, rewrite, or merge customer data as an automatic repair.
- Index definitions can include expressions and predicates; a same-name index with different columns/predicate is not equivalent to the source artifact.
- Constraint-associated indexes do not establish that every referencing foreign-key column set is indexed.

## Missing evidence and unresolved questions

1. Both SQL result sets and their exact row counts.
2. Names/definitions of invalid or not-ready indexes.
3. Names/definitions of unvalidated constraints.
4. Whether source-required primary, foreign-key, unique, and check constraints are missing or differ.
5. Any partial application or same-name object conflict against migration history.
6. Whether existing data satisfies constraints not currently validated.
7. Whether foreign-key referencing columns have relevant supporting indexes where needed.

## Recommendation and next action

**NO-GO for Production changes and for proceeding to Step 5.** No missing object is approved for creation based on this report.

In the Supabase SQL Editor for the existing ENCRIX Production project, verify the project reference is `wrzoqxesffbfirjgotbr`; run the standalone index file and standalone constraint file separately, and save the complete result grids without exposing unrelated application data. Then provide the exact section names, total row counts, all invalid/not-ready index rows, all unvalidated constraint rows, and the complete catalog output for source comparison. Do not run any migration or perform any database write.

