# ENCRIX Final Production Database Audit

**Target project:** `wrzoqxesffbfirjgotbr`  
**Audit query:** [`docs/sql/ENCRIX_FINAL_PRODUCTION_DATABASE_AUDIT.sql`](sql/ENCRIX_FINAL_PRODUCTION_DATABASE_AUDIT.sql)  
**Status:** Prepared for a human-operated, read-only run. It has not been run against Production.

## Purpose and safety

The standalone PostgreSQL 17-compatible query reports catalog metadata only. It does not read application rows, call application RPCs, create temporary objects, change session state, or write data. It returns RLS flags and policies for public tables; effective ACLs on public tables/sequences and all public functions; default ACLs; definitions and ownership/security configuration for entitlement, registration, durable email OTP, and auth helper functions; requested trigger definitions; `email_otps` column and ticket-index metadata; and all 34 repository migration versions mapped to `supabase_migrations.schema_migrations`, including duplicate history versions.

Before running, independently confirm the SQL Editor project reference is `wrzoqxesffbfirjgotbr`. Keep the complete output access-controlled: function bodies and policy expressions are schema metadata and may disclose implementation details, although the query contains no customer records or credential columns. Do not paste OTP data, credentials, or full customer exports into an audit report.

## Result sections

Each result row has `section`, `object_name`, and JSON `details` columns. Empty sections mean no matching catalog objects were returned; for history, expected versions still produce one row each with `NOT_RECORDED`, `RECORDED`, or `DUPLICATE_HISTORY_VERSION`.

| Section | What it reports |
|---|---|
| `RLS_AND_POLICIES` | Every public ordinary/partitioned table’s enabled/forced flags and every policy’s name, command, roles, USING and WITH CHECK expressions. A table with no policy has a row with null policy details. |
| `TABLE_PRIVILEGES` | Effective SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges for `anon`, `authenticated`, and `service_role` on public tables, alongside table owner, role BYPASSRLS/superuser flags, and whether row security applies to that role. |
| `PUBLIC_SCHEMA_AND_ROLE_SECURITY` | Public schema USAGE/CREATE effective privileges and API-role attributes relevant to schema shadowing and RLS. |
| `SEQUENCE_PRIVILEGES` | Effective USAGE/SELECT/UPDATE on public sequences for those API roles. |
| `FUNCTIONS_AND_EXECUTE` | Every overload in the named set (including exact legacy `record_registration_otp_failure(uuid,text)`), signature, owner, result, SECURITY DEFINER, function settings/search_path, raw ACL, effective named-role EXECUTE, PUBLIC EXECUTE, and function definition. |
| `PUBLIC_FUNCTION_EXECUTE_PRIVILEGES` | Owner, SECURITY DEFINER, function settings, ACL, and effective EXECUTE for `PUBLIC`, `anon`, `authenticated`, and `service_role` across all public functions; unrelated function bodies are not returned. |
| `DEFAULT_PRIVILEGES` | Catalog default ACL entries by owner, schema, object type, grantee, and privilege. |
| `TRIGGERS` | Non-internal triggers on organizations, profiles, pending_registrations, billing_payments and organization_subscriptions, including enabled state and associated function security metadata/definition. |
| `EMAIL_OTP_COLUMNS` | Column names, types, nullability, defaults, identity/generated metadata for `public.email_otps`; no table rows. |
| `EMAIL_OTP_TICKET_INDEX` | Presence, exact definition, uniqueness, validity/readiness, and predicate for `email_otps_ticket_id_uidx`. |
| `MIGRATION_HISTORY` | All 34 checked-in migration versions with exact repository filename and count of matching history rows. |
| `DUPLICATE_MIGRATION_HISTORY` | Any schema history version appearing more than once, including versions absent from this repository checkout. |

The audit deliberately inventories RLS/policies and table privileges across **all** public tables, not just billing tables, so the query can reveal unrelated public-table access drift. It does not enumerate direct ACLs for every non-target function; function ACL detail is limited to the six requested conflict names and the three durable email OTP RPC names.

## Repository inventory update — 2026-11-06

This prepared query/report is historical and was not executed in this validation sprint. Its migration-history section covers 34 repository versions, while the current checkout contains 41 migration files. Refresh the query's explicit version mapping and independently review its target reference before any future operator-run audit. No Production or staging connection was made. The local disposable database and SQL suite remain unavailable; see [ENCRIX_COMPLETE_AUDIT.md](ENCRIX_COMPLETE_AUDIT.md) for current infrastructure evidence and all migration/test filenames.

## Interpret carefully

- A missing history entry is not evidence that a migration’s DDL is absent. Compare catalog output to the exact migration source and treat same-name but different definitions as conflicts.
- Effective privilege booleans include inherited role grants. Compare them with the expected migration ACLs and Supabase role memberships; do not infer a safe grant from a boolean alone.
- `SECURITY DEFINER` is not sufficient by itself: verify a fixed safe `search_path`, schema-qualified relations, appropriate owner, and least-privilege EXECUTE ACL.
- A function can have overloads with distinct permissions and behavior. Review every returned overload before any migration that creates/replaces/drops a same-name function.
- Default ACLs affect future object creation; they are not the same as current object grants.
- Trigger absence on a missing table is not meaningful. Confirm the table-existence and migration-object preflights before interpreting a missing trigger as drift.
- `email_otps` output is metadata only. It verifies neither ticket behavior nor OTP rows. The expected ticket RPCs are `issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)`, `cancel_email_otp_ticket(uuid,text,text)`, and `complete_email_otp_verification(uuid,text,text,boolean)`; compare their complete definitions/ACLs to migration `20261031150000_durable_email_otp_attempts.sql`.

## Checks still required in Production before migration approval

1. Run this query in the confirmed Production project and retain the complete result sets for every section; redact only outside the query output if a function body contains a secret or customer-specific literal. If any body contains such content, do not circulate it—ask the database owner to compare it locally against the migration source and return a pass/fail plus a redacted diff.
2. Confirm every current public table/sequence privilege and policy against the full chronological migration chain, especially security migrations `20261031130000` and `20261031140000`. Investigate any grants to `PUBLIC`, `anon`, or `authenticated` that permit direct access to billing, OTP, registration-attempt, pilot, or payment data.
3. Confirm RLS is enabled on sensitive tables; compare forced-RLS expectations with source rather than assuming every table must force it. Check policy command, roles, USING and WITH CHECK exactly. Resolve duplicate/overly broad policies and any policy on unexpected tables.
4. Review all function overloads, owners, definitions, search paths, and effective EXECUTE for service_role/anon/authenticated/PUBLIC. Confirm whether `record_registration_otp_failure(uuid,text)` exists and whether anything depends on it before considering migration `20261031000000`.
5. Confirm every listed non-internal trigger and enabled state on the five requested tables; compare trigger body and referenced function to migrations. Missing expected trigger or unexpected trigger is a blocker pending explanation.
6. Confirm `email_otps` has the exact expected 11 columns/types/nullability/defaults, a valid and ready unique partial ticket index, and only the intended issue/cancel/complete RPC signatures. Confirm function owner, SECURITY DEFINER, fixed search path, schema qualification and service_role-only execution. Earlier OTP verification is historical evidence; rerun it now. Do not replay its migration.
7. Confirm all 34 migration history versions, check for duplicates, and reconcile each status to object effects. Do not insert/update history manually and do not treat a recorded version as proof its current effects are intact.
8. Resolve every same-name conflict and any missing/partial effect using reviewed source diffs. Run the migration candidates in a disposable PostgreSQL 17/Supabase-compatible environment first, including rollback/failure behavior and security tests.
9. Re-run the existing read-only table/column/constraint/index/data-aggregate prerequisites against the same Production snapshot. Check duplicate constraints without revealing affected values; verify counts and schema have not changed since the reported preflight.
10. Obtain explicit approval before any Production write. No migration execution SQL is included in this audit artifact.

## Validation performed locally

The repository inventory was checked and contains 34 migration filenames; the query's expected-version list is aligned to those names. The query is a single `WITH ... SELECT` statement built from `pg_catalog` reads and a read-only join to Supabase migration history. No PostgreSQL 17 server/client/parser (`psql`, `postgres`, `pg_config`, or `pg_format`) was available in the local environment, so server parsing/runtime compatibility could not be independently exercised. No SQL was run against Production or staging. Review the query in a disposable PostgreSQL 17 Supabase-compatible database before relying on it operationally.
