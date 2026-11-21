# ENCRIX Database Validation Report

**Assessment date:** 2026-11-08  
**Scope:** Repository migrations and SQL regression tests only. No remote database was contacted or modified.

## Environment and commands

Docker Desktop was unavailable: the Docker CLI could not connect to its Linux engine, and the Docker Desktop executable was not installed at the standard path. A native PostgreSQL 17.11 installation was available. A new cluster was created under the session-state directory, bound only to `127.0.0.1:55439`, configured with `wal_level=logical`, and removed after validation. The pre-existing PostgreSQL Windows service was not used or modified.

The database was created as UTF-8 from `template0`. Because this was native PostgreSQL rather than the Supabase CLI stack, a minimal local Supabase-compatible baseline was bootstrapped: `anon`, `authenticated`, and `service_role`; `auth.users`, `auth.uid()` and `auth.role()`; the `extensions` schema; `supabase_realtime`; and Supabase-like public-schema default grants. This does not emulate Supabase Auth, Storage, Realtime service behavior, or a hosted project.

Commands used (PowerShell; `$data` was the disposable session-state directory):

```powershell
$PG = 'C:\Program Files\PostgreSQL\17\bin'
& "$PG\initdb.exe" -D $data -U postgres --auth-local=trust --auth-host=trust
& "$PG\pg_ctl.exe" -D $data -l "$data\server.log" -o "-h 127.0.0.1 -p 55439 -c listen_addresses=127.0.0.1 -c wal_level=logical" -w start
& "$PG\createdb.exe" -h 127.0.0.1 -p 55439 -U postgres --template=template0 --encoding=UTF8 encrix_rc_validation_final
& "$PG\psql.exe" -X -w -h 127.0.0.1 -p 55439 -U postgres -d encrix_rc_validation_final -v ON_ERROR_STOP=1 -f $migration.FullName
& "$PG\psql.exe" -X -w -h 127.0.0.1 -p 55439 -U postgres -d encrix_rc_validation_final -v ON_ERROR_STOP=1 -f $test.FullName
```

The migration and test commands were run in separate PowerShell loops over files sorted by name. `ON_ERROR_STOP=1` was used for every SQL file.

## Results

- Migrations: **41/41 passed**, in timestamp/name order, on PostgreSQL 17.11 with logical WAL enabled.
- SQL regression tests: **16/16 passed**.
- Public tables: **35 total; 35 have RLS enabled**.
- Public tables readable by `anon` or `authenticated` without RLS: **0**.
- Public `SECURITY DEFINER` functions without a configured `search_path`: **0**.
- `FORCE ROW LEVEL SECURITY`: **0 tables**. This is recorded as a catalog observation, not an automatic failure; ownership and bypass-role behavior still need staging confirmation.
- Tenant-isolation and telecaller access regression tests passed: `phase23_8_inactive_profile_rls`, `phase24_3_telecaller_lead_access`, and `phase24_7_server_telecaller_leads`.
- Relevant ACL and function-hardening tests passed: `public_leads_privilege_hardening` and `security_definer_search_path_hardening`, alongside the other 11 SQL tests.

## Initial failures and remediation

1. The first native migration attempt stopped at `20261012000000_phase17_realtime_crm_telephony.sql` because a vanilla PostgreSQL cluster does not create Supabase's `supabase_realtime` publication. A fresh validation database was created with that publication and the Supabase-compatible role/schema scaffold; the full 41-migration chain then passed.
2. The first SQL test attempt passed 14/16. `phase23_8_inactive_profile_rls.test.sql` lacked the Supabase default table grants for `authenticated`, and `security_definer_search_path_hardening.test.sql` lacked the expected default function grant for `service_role`. These were harness-baseline differences, not migration edits. A new clean database was initialized with Supabase-like default privileges and logical WAL, all 41 migrations were rerun, and all 16 tests passed.

These initial failures and corrections are retained here for auditability. The corrected run is meaningful native PostgreSQL evidence, not proof of equivalence to Supabase's managed stack.

## ACL observation requiring follow-up

Catalog inspection found `public.prevent_audit_tampering()` is `SECURITY DEFINER` with `search_path=public, pg_temp` and `EXECUTE` granted to `PUBLIC`, `anon`, `authenticated`, and `service_role`. It is a `RETURNS trigger` function attached to `activity_logs` and `security_events`; this is not evidence that an anonymous caller can invoke it as an ordinary SQL function. The grants are nevertheless broader than necessary for a trigger-only function. Review and, if confirmed safe, remove unnecessary direct grants in a new migration with a regression assertion. No migration or ACL was changed during this preparation.

## Remaining database risks

- Docker-based Supabase local infrastructure could not be started because Docker Desktop was unavailable. The project includes a Supabase CLI dependency, but that stack was not run. Hosted Supabase Auth, Storage, Realtime, extensions, and managed role defaults were not exercised.
- No staging database credential separation or remote migration history was inspected.
- No remote migration was applied. Production was not contacted.
