# ENCRIX Database Release Audit & Migration Readiness

## Main Production preflight update — 2026-11-09

This is the current read-only evidence and supersedes the earlier remote-state-unknown status below. Historical sections retain their original scope/date and are not current Production assertions.

- Confirmed main Supabase project `ENCRIX`, ref `wrzoqxesffbfirjgotbr`, PostgreSQL `17.11`, region `eu-west-1`, active/healthy. The local Supabase CLI link points to `vhqqczgomrznisvbhpvf` (`ENCRIX-Staging`); main-project history inspection explicitly selected `wrzoqxesffbfirjgotbr`.
- The remote migration ledger records only `20261001000000` and `20261001000001`. The repository now contains 41 migration files; the remaining 39 are not recorded. The ledger alone does not establish whether those DDL effects are absent, complete, partial, or conflicting.
- Direct catalog queries failed because the CLI temporary DB role could not authenticate. No database password was read, printed, or requested. Actual Production tables, columns, constraints/data compatibility, RLS policies, functions/owners/grants, and extensions remain unknown. Two immutable audit triggers were the only trigger details confirmed by a successful read-only check.
- Backup/restore readiness and customer-data compatibility are unknown. No data rows or secrets were exposed and no database writes/migrations were made.
- Production application tests/build/lint were locally evidenced as 90 test files / 1,008 tests passed, build exit 0, lint exit 0 with 140 warnings. The isolated PostgreSQL 17 run applied 41/41 local migrations and passed 16/16 SQL regression tests; these results do not validate Production.
- Current recommendation: **NO-GO** for Production migration/deployment until catalog/data comparison, restorable backup/PITR evidence, Vercel/Auth verification, and separate operation approvals are complete. See [production migration plan](./ENCRIX_DATABASE_MIGRATION_PLAN.md) and [release report](../RELEASE_CANDIDATE_REPORT.md).

**Audit date:** 2026-11-01  
**Scope:** Static source review of all repository SQL migrations and SQL regression tests. No database was queried or changed.

## Integration validation update — 2026-11-06

The current checkout contains 41 ordered migration files and 16 `*.test.sql` regression files; none were executed in this follow-up. Docker Desktop and the Supabase CLI are installed, but the Docker daemon is unavailable. Supabase local ports 54322–54324 are not listening. Port 5432 is owned by an unidentified existing PostgreSQL process and was not queried, stopped, or modified. A separate staging Supabase project is configured in local environment files, but no remote project was contacted. Exact current filenames and NOT RUN status are recorded in [ENCRIX_COMPLETE_AUDIT.md](ENCRIX_COMPLETE_AUDIT.md).

## Executive status

**Release database readiness is not established.** The repository contains 31 migrations and 12 SQL regression files. The one permitted Docker availability check failed because the Docker Desktop Linux-engine pipe was absent:

```text
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
The system cannot find the file specified.
```

Following the requested stop rule, no database connection, SQL execution, migration application, reset, history repair, or replacement database attempt was made. The current migration history and actual catalog state are therefore **UNKNOWN**. Migration filenames and source SQL below describe expected effects only; they do not prove application.

Prior local-validation reports in this chat are historical evidence about the then-used temporary project only. They do not establish that the same database is currently available or prove current migration history. No staging or production database was accessed.

## Migration inventory and evidence classification

For every row, “expected effects” are derived from the named source migration. “Database status” is **UNKNOWN** because no current PostgreSQL catalog/history was available. Dependencies are source-derived ordering requirements; verify them against the actual target before any baseline or apply operation.

| Version / file | Expected schema effects (source review) | Key dependencies / risk notes | SQL regression coverage | Current database status |
|---|---|---|---|---|
| `20261001000000_init_leadvault.sql` | Creates `organizations`, `profiles`, `leads`, `lead_assignments`, `calls`, `call_outcomes`, `follow_ups`, `messages`, `notifications`, `activity_logs`, `security_events`, `user_sessions`; organization/assignment indexes; auth helper functions; enables RLS and creates the base policy set; installs `uuid-ossp` in `extensions`. | Foundational schema; requires Supabase `auth` objects/roles and `extensions` schema. Base policies and grants must be reviewed with later hardening migrations. | No dedicated SQL regression file. | **UNKNOWN** |
| `20261001000001_security_hardening.sql` | Adds audit immutability trigger functions/triggers, phone masking, authorized-call and caller-state functions; revokes audit mutation privileges and grants telecaller view/call function access. | Requires initial tables and `telecaller_leads_view`. Later migrations replace or revoke portions of this access. | No dedicated SQL regression file. | **UNKNOWN** |
| `20261006000000_production_telephony_recordings.sql` | Creates `webhook_events`, changes `calls.status` constraint, defines three recording authorization SECURITY DEFINER functions, RLS and indexes. | Requires calls and Supabase roles; functions initially use `search_path = public, pg_temp`; two-argument function is service-role-only, other recording functions permit authenticated execution. Later search-path migration changes selected functions. | No dedicated SQL regression file; API tests are not proof of SQL ACL/catalog state. | **UNKNOWN** |
| `20261007000000_otp_authentication_and_onboarding.sql` | Adds profile phone verification/status rules; creates `organization_invitations`, `pending_registrations`, `phone_otps`, indexes, RLS and policies. | Requires profiles/organizations. Later email OTP and onboarding integrity migrations modify pending registration behavior and introduce durable ticket checks. | Covered only in part by later onboarding/OTP SQL tests. | **UNKNOWN** |
| `20261008000000_email_otp_authentication.sql` | Adds profile email fields/indexes; creates `email_otps` with lookup/expiry indexes, RLS and service-only policy; makes invitation/pending-registration phone nullable; changes pending-registration email uniqueness and adds email indexes. | Depends on 070 tables. Email nullable/unique semantics and legacy data compatibility require catalog/data preflight. | Durable OTP regression (311500); partial onboarding coverage (310000). | **UNKNOWN** |
| `20261012000000_phase17_realtime_crm_telephony.sql` | Creates `call_recordings`; adds call/lead/security/invitation indexes; creates tenant recording policy; adds calls, leads, follow-ups and security events to `supabase_realtime`. | Requires publication and earlier tables. Publishing raw `leads` is later deliberately reversed by 311200; do not restore raw lead publication during rollback. | No dedicated migration test; realtime/recording coverage is partial in other tests. | **UNKNOWN** |
| `20261013000000_phase18_secure_student_details_zero_phone.sql` | Changes lead access/view projection; creates `get_telecaller_student_detail(uuid)` and grants authenticated execution. | Requires `leads`, profiles, view and auth helpers. Later migrations replace the public wrapper and add tenant checks. | No dedicated SQL regression; telecaller SQL/API tests cover related access only. | **UNKNOWN** |
| `20261014000000_phase20_smart_lead_distribution.sql` | Creates `distribution_configs`; alters leads/lead assignments for distribution fields; adds workload/queue/history indexes, RLS and owner/admin policies. | Requires leads, profiles and assignments. Check existing rows against new constraints/defaults before apply. | No dedicated SQL regression; application tests only. | **UNKNOWN** |
| `20261015000000_phase21_smart_follow_up_engine.sql` | Adds follow-up workflow/reminder columns, partial indexes, and replaces owner/telecaller follow-up policies. | Requires existing follow-ups/profiles/leads; partial indexes can scan/lock based on table size. Later cron migration builds on this schema. | No dedicated SQL regression; application tests only. | **UNKNOWN** |
| `20261018000000_phase22_security_critical_remediation.sql` | Adds profile privilege protection trigger/function; changes pending registration and lead fields/index; tightens profile and lead policies; redefines call/detail SECURITY DEFINER RPCs and grants. | Large behavior-changing migration. Depends on base policies/functions and `auth.uid()`. Existing rows/status/roles and function ACLs need preflight. | No dedicated SQL regression; later profile/lead tests cover fragments. | **UNKNOWN** |
| `20261019000000_phase22_phone_exposure_remediation.sql` | Alters search paths of auth/audit/caller/recording helpers; hardens telecaller view grants; replaces student-detail RPC. | Depends on all named functions. Uses `public, pg_temp` for several functions; later 311400 narrows eight paths. | No dedicated SQL regression. | **UNKNOWN** |
| `20261020000000_phase23_followup_reminder_concurrency.sql` | Defines concurrent-safe `process_follow_up_reminders_cron(timestamptz,uuid)` SECURITY DEFINER function, service-role-only execution. | Depends on phase21 follow-up columns/indexes and service role. Function uses `public, pg_temp`; replaced in 210000 and later paid-entitlement-gated in application cron. | No dedicated SQL regression; concurrency under independent sessions is not demonstrated by a source-only review. | **UNKNOWN** |
| `20261021000000_phase23_7_production_blocker_remediation.sql` | Replaces profile privilege trigger and adds trusted `grant_platform_admin(uuid)`; hardens raw lead policy and telecaller detail wrapper; changes reminder function. | Requires prior profile, lead and reminder objects. Admin provisioning must remain service-role-only; function definitions/owners and grants need live catalog validation. | No dedicated SQL regression; related lead/profile tests cover portions. | **UNKNOWN** |
| `20261022000000_phase23_8_active_profile_rls.sql` | Creates active-profile helper and replaces auth/caller helpers with profile-status-aware SECURITY DEFINER definitions/grants; adjusts policies. | Requires profiles and auth functions. Status policy behavior is security-critical and should be catalog-tested against active/inactive profiles. | `phase23_8_inactive_profile_rls.test.sql` (transaction/rollback). | **UNKNOWN** |
| `20261023000000_billing_foundation.sql` | Creates `organization_subscriptions`, `billing_payments`, `billing_webhook_events`; unique-current and lookup indexes; enables RLS, revokes browser/PUBLIC access and grants service-role table access. | Requires organizations, profiles, UUID extension, Supabase roles. All later billing migrations depend on these tables. | No standalone SQL test; lifecycle SQL test checks preserved table RLS. | **UNKNOWN** |
| `20261023120000_secure_caller_enrollment_bridge_persistence.sql` | Adds profile organization uniqueness index; creates `caller_phone_enrollments` and `call_bridges`; adds call identity indexes; defines enrollment and profile-phone trigger functions; service-only table/RPC access. | Depends on profiles/calls/leads/organizations, UUID extension and Twilio callback model. Active/pending uniqueness and call FK compatibility need data preflight. | No dedicated SQL regression file; application tests only. | **UNKNOWN** |
| `20261024100000_phase24_1_security_remediation.sql` | Revokes direct authorized-call RPC execution; replaces phone-update protection and telecaller lead-column guard trigger. | Depends on profiles/leads and caller enrollment schema. Trigger replacement is replay-sensitive; verify definitions/ownership first. | No dedicated SQL regression; later telecaller privilege test covers some guarantees. | **UNKNOWN** |
| `20261024120000_phase24_3_secure_telecaller_lead_access.sql` | Restricts telecaller view grants; creates `update_assigned_telecaller_lead(uuid,text,text)` SECURITY DEFINER with `pg_catalog, pg_temp` path and authenticated execution. | Depends on view, leads, profiles and helpers. The RPC is a browser-facing mutation boundary and requires exact privilege/tenant tests. | `phase24_3_telecaller_lead_access.test.sql` (transaction/rollback; psql meta-commands). | **UNKNOWN** |
| `20261024130000_phase24_7_server_telecaller_leads.sql` | Adds service-side assigned-lead read/update SECURITY DEFINER RPCs; explicit function ACLs and comments. | Depends on lead/profile/view shape. API routes use service-role access; direct client functions should remain unavailable. | `phase24_7_server_telecaller_leads.test.sql` (transaction/rollback; psql meta-commands). | **UNKNOWN** |
| `20261027000000_phase32_realtime_publications.sql` | Adds profiles and invitations to `supabase_realtime` using guarded publication changes. | Requires Realtime publication. Verify exact publication membership before any baseline. | No dedicated SQL regression. | **UNKNOWN** |
| `20261028000000_phase33_realtime_notifications.sql` | Adds notifications to publication and sets `REPLICA IDENTITY FULL`. | Requires notifications/publication. FULL identity may increase WAL/event payload and should be checked against actual consumers. | No dedicated SQL regression. | **UNKNOWN** |
| `20261030000000_owner_business_billing_details.sql` | Adds business detail columns to organizations and pending registrations; adds case-insensitive profile email uniqueness and unique organization owner index. | Requires base tables. Can fail on duplicate `lower(profiles.email)` or duplicate non-null owner IDs; duplicate preflight and manual repair are prerequisites. | `onboarding_billing_integrity.test.sql` covers later registration/billing behavior, not a complete schema compatibility check. | **UNKNOWN** |
| `20261030120000_owner_csv_import_persistence.sql` | Adds normalized-phone/import-marker indexes, lead phone guard trigger/function, transactional SECURITY DEFINER `create_owner_lead` and `import_owner_leads` RPCs with service-role-only execution. | Requires lead/profile/distribution schemas, UUID extension, role fields and existing assignment semantics. Trigger and advisory-lock behavior must be inspected against live concurrent owner creation. | `owner_csv_import_persistence.test.sql` (transaction/rollback; psql meta-commands). | **UNKNOWN** |
| `20261031000000_onboarding_billing_integrity.sql` | Creates/extends registration OTP attempt state; defines issue/status/verify/cancel RPCs and atomic owner-registration RPC; adds payment identity trigger and billing amount/subscription/timestamp constraints. | Depends on 300 business columns, pending registrations, profiles/organizations, billing foundation and Supabase roles. Constraint preflights and duplicate-owner/email checks are important; no cleanup should be automated. | `onboarding_billing_integrity.test.sql` (transaction/rollback; psql meta-commands). | **UNKNOWN** |
| `20261031120000_sanitized_lead_refresh_signals.sql` | Creates metadata-only `lead_refresh_signals`, partial unique cursor indexes, RLS read policies, trigger/helper functions; removes raw leads from Realtime and adds only five signal columns. | Requires PostgreSQL 15+, `supabase_realtime`, profiles/orgs/leads and auth helpers. Deliberately removes raw leads publication. Publication rollback must not restore raw leads. | `lead_refresh_signals.test.sql` (transaction/rollback; psql meta-commands; original test had 31 assertions in a prior local run report). | **UNKNOWN** |
| `20261031130000_public_leads_privilege_hardening.sql` | Removes table and column ACLs on `public.leads`; restores service-role SELECT and five-column UPDATE; tenant-checks detail RPC; adjusts postgres defaults in `public`; fails closed on unexpected global default ACLs. | Depends on the actual default ACL catalog and all server query columns. It intentionally leaves global PUBLIC function EXECUTE defaults unchanged. Must verify stored/effective ACLs and service-role operations. | `public_leads_privilege_hardening.test.sql` (transaction/rollback). | **UNKNOWN** |
| `20261031140000_security_definer_search_path_hardening.sql` | `ALTER FUNCTION ... SET search_path = pg_catalog, pg_temp` for eight named SECURITY DEFINER functions; intended to preserve body/owner/ACL. | Requires all eight exact signatures. Preflight should abort if any are missing or not SECURITY DEFINER. Execution does not prove runtime behavior under narrowed path. | `security_definer_search_path_hardening.test.sql` (transaction/rollback). | **UNKNOWN** |
| `20261031150000_durable_email_otp_attempts.sql` | Adds email OTP ticket/verification columns and ticket index; defines issue/atomic verify/cancel SECURITY DEFINER RPCs with service-role-only ACLs. | Depends on `email_otps` from 080. SQL test verifies row locking structurally and sequential attempt lifecycle; it is not a multi-session PostgreSQL race test. | `durable_email_otp_attempts.test.sql` (transaction/rollback). | **UNKNOWN** |
| `20261031160000_organization_twilio_calling.sql` | Creates encrypted-envelope organization Twilio credential storage and inbound attempt log; extends call bridge state/flow; adds active-phone/call indexes and service-role RPCs for credential, call and inbound lifecycle. | Depends on organizations/profiles/leads/calls/call_bridges, UUID extension and server-side encryption key configuration. DB stores nonce/ciphertext/tag/key ID, not plaintext token. Verify key rotation and no plaintext columns. | `organization_twilio_calling.test.sql` (transaction/rollback). | **UNKNOWN** |
| `20261031170000_razorpay_atomic_subscription_lifecycle.sql` | Adds refund/total-count fields and checks, verified-payment index, and atomic SECURITY DEFINER payment/subscription state RPC with service-role-only execution. | Depends on billing foundation and onboarding integrity columns/constraints. Constraint preflights may fail on incompatible or invalid existing rows; webhook and provider verification remain application/provider concerns. | `razorpay_atomic_subscription_lifecycle.test.sql` (transaction/rollback; psql meta-commands). | **UNKNOWN** |
| `20261031180000_paid_subscription_entitlement_gate.sql` | Creates service-role-only SECURITY DEFINER boolean RPC checking current active Business ₹9,999 subscription and matching signature-verified captured Razorpay payment within period, not fully refunded. | Depends on 230000, 310000 and 1700 billing columns. Application route gates fail closed if the RPC is unavailable. SQL function correctness and grants still require PostgreSQL execution. | `paid_subscription_entitlement_gate.test.sql` (transaction/rollback; psql meta-commands). | **UNKNOWN** |

### Extension, platform, and ordering dependencies

- The first migration installs `uuid-ossp` in `extensions`; multiple migrations call `extensions.uuid_generate_v4()`.
- Later SQL calls Supabase `auth.uid()` and relies on `auth.users`, `anon`, `authenticated`, `service_role`, `auth` and `supabase_realtime`. These must exist in the validation database; a plain PostgreSQL instance is insufficient without Supabase bootstrap objects.
- PostgreSQL 15+ is explicitly required by the sanitized Realtime publication column list. Repository config declares major version 17, but the target server version was not observed in this audit.
- `supabase/config.toml` declares `major_version = 17`, but has `[db.seed].enabled = true` and `sql_paths = ["./seed.sql"]`. A future disposable validation project should disable seeding in its isolated config; never use `db reset` on an unidentified or data-bearing database.
- Strict filename order is not the only prerequisite: 30000000 precedes 30120000 and 31000000; 31000000 depends on 30000000 and billing foundation; 31150000 depends on 08000000; 31160000 depends on calls/call_bridges and prior phone-enrollment schema; 31170000 depends on 23000000 and 31000000; 31180000 depends on 31170000; 31120000 precedes 31130000; 31140000 requires its eight functions to exist.
- Migration files with explicit top-level `BEGIN;` / `COMMIT;` wrappers are 311300, 311400, 311600, 311700 and 311800. The other 26 files do not consistently state top-level wrappers; confirm the selected Supabase CLI transaction behavior and inspect DDL before release.

## Security and consistency findings from source review

These are source observations, not live catalog conclusions:

1. **Raw lead Realtime exposure is addressed in source.** The initial Realtime migration publishes `public.leads`; 311200 removes it and publishes only five metadata cursor columns. Current publication state is unknown.
2. **Direct lead table access is intentionally constrained.** 311300 removes PUBLIC/anon/authenticated/service-role ACLs, then gives service_role table SELECT and column UPDATE on `assigned_to`, `status`, `updated_at`, `priority`, `notes`. It also revokes all public-schema table/sequence defaults and role-specific function defaults for `postgres`; it does not remove global default ACLs or PostgreSQL's global PUBLIC EXECUTE behavior. Its global-ACL preflight is a deliberate fail-closed deployment blocker if unexpected entries exist.
3. **SECURITY DEFINER path history exists.** Earlier functions use `public, pg_temp`; 311400 narrows eight named functions. Other SECURITY DEFINER functions in later migrations set catalog-first paths and schema-qualify app objects. Verify the complete live function inventory, owner, `proconfig`, body and ACLs before release.
4. **OTP state is database-backed in source.** Registration attempts and login/invitation email OTP have separate persistence/RPC paths. `310000` protects registration verification and owner creation; `311500` protects LOGIN/INVITATION attempts. Their SQL tests check sequential limit/replay and locking shape, but actual concurrent sessions are still required to validate races.
5. **Twilio credentials are an encrypted envelope at rest in the schema.** Migration 311600 stores key ID, nonce, ciphertext and auth tag with service-role-only table access. Encryption/decryption, key custody/rotation, Twilio signature verification and provider behavior are application/environment responsibilities; none was live-tested here.
6. **Razorpay payment/subscription identity is transactionally guarded in source.** 310000 adds identity/state constraints and trigger; 311700 adds payment application RPC; 311800 gates CRM access on active/current Business state and a matching captured verified payment. SQL review cannot establish current stored constraints, grants, table data, or live webhook behavior.
7. **Cross-tenant checks are duplicated at API/RPC boundaries in source.** Owner/telecaller handlers and lead RPCs constrain organization/assignment. Realtime policies constrain organization or addressed telecaller. Live RLS expressions, function privileges, and actual deployed API code/config are unverified.
8. **Important operational risk:** the SQL regression files are not a substitute for provider tests or multi-session concurrency tests. OTP, payment, lead dedupe, and Twilio callback race behavior needs independent connections against disposable PostgreSQL and sandbox provider accounts.

### Column and constraint delta notes

The migration table above names all created/altered relations and the principal effects. The following lists the concrete column/constraint deltas that otherwise are easy to miss in a filename-level review:

- `20261001000000`: core tenant FKs use `ON DELETE CASCADE` for tenant-owned CRM rows; `organizations.slug` and `profiles.user_id` are unique; role/status/lead priority/outcome/follow-up/severity columns have enumerated checks. `leads.assigned_to` and several audit references use `ON DELETE SET NULL`.
- `20261001000001`: no table-column delta; triggers make activity/security audit rows immutable and functions implement masking/call authorization.
- `20261006000000`: creates unique `webhook_events.provider_event_id`; replaces `calls_status_check` with a call-state enum. Treat constraint replacement as behavior-changing.
- `20261007000000`: `profiles.phone_verified BOOLEAN NOT NULL DEFAULT FALSE`; expands `profiles_status_check`; invitation role/status/token and pending/phone OTP purpose/attempt/expiry checks are declared in newly created tables.
- `20261008000000`: `profiles.email VARCHAR(255)` and `email_verified BOOLEAN NOT NULL DEFAULT FALSE`; `email_otps` has `email`, `purpose`, `otp_hash`, `attempts`, `resend_after`, `expires_at`, `used`, `created_at` with purpose check; makes pending/invitation `phone_number` nullable; replaces pending email uniqueness with `UNIQUE(email)`.
- `20261012000000`: `call_recordings` has tenant/call FKs with cascades, provider/storage/duration/status/timestamps; tenant policy filters by active profile and assigned call. No existing column alteration.
- `20261013000000`: adds lead student/contact-detail fields: `father_name`, `mother_name`, NEET/EAMCET score/rank/year/attempts, IPE marks/percentage/year/attempts, category, gender, city, state, school/college, course interest. These are nullable additions.
- `20261014000000`: `distribution_configs` adds unique organization FK, mode enum (`MANUAL`, `ROUND_ROBIN`, `WORKLOAD_BALANCED`), enable flag, positive optional max workload, eligible IDs JSONB, nonnegative round-robin cursor, updater and timestamps. Leads gain `unassigned_reason`, `reassigned_at`, `reassign_reason`; assignment history gains `previous_user_id` FK and `mode`.
- `20261015000000`: follow-up status enum gains scheduled/due/rescheduled/overdue states; adds creator/timezone/reason/completion/outcome/reschedule/history/reminder/escalation fields and nullable profile FKs for creator/escalator. It drops/recreates `follow_ups_status_check` and replaces two policies.
- `20261018000000`: profiles/pending registration email updates and uniqueness; leads gain `last_contacted_at` and non-null `calls_count DEFAULT 0`; policy/function/trigger definitions are replaced. Verify current email duplicates and any existing lead data before applying.
- `20261019000000`: no table-column delta; changes function paths and replaces student detail function/grants.
- `20261020000000`: no table-column delta; replaces reminder RPC body/permissions.
- `20261021000000`: no table-column delta; replaces profile trigger, admin grant RPC, lead policies, student detail and reminder functions.
- `20261022000000`: no table-column delta; adds restrictive active-profile policy logic and replaces auth helper bodies/ACLs.
- `20261023000000`: subscription columns include plan/status/source/current/idempotency/checkout lifecycle, amount and Razorpay IDs, period/cancel/end/payment timestamps; checks constrain plan/status/source/checkout state and period order, with unique `(id, organization_id)` and one-current-per-org index. Payments include org/subscription FK pair, unique payment/idempotency IDs, positive amount, INR and status checks, verification/paid/failed timestamps. Webhook event uniqueness is `(provider, provider_event_id)` with payload digest/status checks. FKs use RESTRICT for billing history.
- `20261023120000`: caller enrollment has organization/profile composite FK, `attempts BETWEEN 0 AND 5`, phone format and expiry checks, one pending enrollment per profile. `call_bridges` carries call/org/telecaller composite FKs, unique provider SIDs/conference/idempotency tuple, state checks and failure-code check. Adds composite unique indexes required by those FKs.
- `20261024100000`: no column delta; replaces phone-write and protected-lead-column triggers and revokes browser call RPC execution.
- `20261024120000`: no column delta; replaces the telecaller update RPC and exact execution matrix.
- `20261024130000`: no column delta; adds server-only lead read/update RPCs.
- `20261027000000`: no column delta; publication membership only.
- `20261028000000`: no column delta; publication membership plus notifications `REPLICA IDENTITY FULL`.
- `20261030000000`: adds `business_email`, `business_phone`, `business_location`, `website_url` to organizations and pending registrations; unique `lower(profiles.email)` partial index and unique `organizations.owner_id` index. Both may fail on duplicates; comments provide read-only preflights and require manual resolution.
- `20261030120000`: no new lead columns in the migration; adds non-unique tenant-normalized-phone and CSV marker indexes, guarded insert trigger, shared lock and service-only create/import RPCs. It deliberately does not make normalized phone unique.
- `20261031000000`: registration ticket table contains `ticket_id`, email, hash, attempts (0..5), verified/consumed timestamps and expiry; adds pending `otp_ticket_id`; adds amount-required, non-null payment subscription, and captured/failed timestamp checks. Adds payment identity/status transition trigger; status ordering and captured metadata preservation are encoded in trigger body.
- `20261031120000`: `lead_refresh_signals(id identity, organization_id, nullable recipient_profile_id, positive revision, updated_at)` with cascading organization/profile FKs and partial unique organization/profile cursors. No lead PII fields. RLS read scopes, trigger handles insert/update/delete/reassignment/org-move. Publication contains only the five listed columns.
- `20261031130000`: no table-column delta; removes table and every discovered column ACL from `leads`, then grants service SELECT and UPDATE only for `assigned_to`, `status`, `updated_at`, `priority`, `notes`; schema-default ACL changes are limited to `public` and guarded by a global ACL preflight.
- `20261031140000`: no table-column delta; path-only `ALTER FUNCTION` for eight exact signatures.
- `20261031150000`: adds nullable `email_otps.ticket_id` and `verified_at`; partial unique index on non-null ticket IDs; database RPCs lock OTP row and update attempts/use/verification atomically.
- `20261031160000`: encrypted Twilio envelope columns are `key_id`, `nonce`, `ciphertext`, `auth_tag`; checks enforce number/key/nonce/tag formats and nonempty ciphertext; one active number per phone. `call_bridges` gains checked `flow` and expanded customer leg states; inbound attempts have unique Twilio SID and enumerated outcome.
- `20261031170000`: adds `billing_payments.amount_refunded_paise BIGINT NOT NULL DEFAULT 0` and optional `organization_subscriptions.razorpay_total_count`; validates refund range/status and positive total count; adds captured-and-verified lookup index and atomic payment/subscription transition RPC.
- `20261031180000`: no table-column delta; read-only entitlement predicate is fixed to Business/999900 paise and matches captured verified Razorpay payment, organization/subscription, and current period.

## SQL regression test inventory

There are **12** `supabase/tests/*.test.sql` files. They use SQL `DO` blocks/explicit exceptions rather than pgTAP. Source inspection found an outer `BEGIN` and final `ROLLBACK` in all 12. Seven use psql meta-commands (`\set`, `\ir`, or similar) and should be run using documented `psql -X -v ON_ERROR_STOP=1 -f <file>` rather than a generic SQL editor or a CLI `--file` interface unless that CLI explicitly supports psql meta-commands.

| SQL test | Primary migration / requirements | Execution properties and gaps |
|---|---|---|
| `durable_email_otp_attempts.test.sql` | 311500; durable attempts, max five, expiry, replay/cancel, RPC security. | Transaction/rollback. Sequential RPC checks and function-definition lock assertion; **does not prove simultaneous PostgreSQL session behavior**. |
| `lead_refresh_signals.test.sql` | 311200; sanitized signal columns, policies, cursor advancement, reassignment, trigger and internal ACLs. | Transaction/rollback; psql meta-commands. Prior local run report said 31 assertions passed, but current DB not available. |
| `onboarding_billing_integrity.test.sql` | 300000 + 310000; verified ticket and atomic registration/payment integrity. | Transaction/rollback; psql meta-commands. Requires auth/profile/org fixtures and existing schema. |
| `organization_twilio_calling.test.sql` | 311600; encrypted storage, constraints, RPC ACLs, call bridge and inbound attempt security. | Transaction/rollback. Does not contact Twilio or prove encryption-key deployment/rotation. |
| `owner_csv_import_persistence.test.sql` | 301200; service-only RPCs, row limits, tenant safety, distribution, duplicate/retry, audits and indexes. | Transaction/rollback; psql meta-commands. Does not establish cross-session lock correctness by itself. |
| `paid_subscription_entitlement_gate.test.sql` | 311800; entitlement conditions, partial/full refund, expiry/renewal and function ACL. | Transaction/rollback; psql meta-commands. Requires billing schemas and prior lifecycle fields. |
| `phase23_8_inactive_profile_rls.test.sql` | 220000; active-profile RLS and direct-lead privilege denials. | Transaction/rollback; no psql meta-commands. Some API-boundary behavior is intentionally tested in Vitest instead. |
| `phase24_3_telecaller_lead_access.test.sql` | 241200; safe telecaller projection/RPC and denied direct leads access. | Transaction/rollback; psql meta-commands. |
| `phase24_7_server_telecaller_leads.test.sql` | 241300; server RPC security and assigned-only behavior. | Transaction/rollback; psql meta-commands. |
| `public_leads_privilege_hardening.test.sql` | 311300; exact table/column ACL, MAINTAIN, default ACL preflight, function ownership/ACL and RLS. | Transaction/rollback. Must run on PostgreSQL 17 for MAINTAIN checks. |
| `razorpay_atomic_subscription_lifecycle.test.sql` | 230000 + 310000 + 311700; atomic payment state, constraints and RPC ACL. | Transaction/rollback; psql meta-commands. Does not simulate simultaneous webhook delivery or actual Razorpay responses. |
| `security_definer_search_path_hardening.test.sql` | 311400; exact `proconfig`, owners/SECURITY DEFINER and unchanged EXECUTE matrix. | Transaction/rollback. Catalog test; it does not prove all function behavior after changing search paths. |

All SQL fixtures are intended to roll back, but test execution still needs a disposable database with the complete prerequisite Supabase schemas, roles, extension, functions, and publication. Some tests temporarily alter catalog-visible objects inside the transaction; confirm psql reaches the final `ROLLBACK` and verify fixture absence afterward. Do not use `db reset` against a database with unknown user data.

## Database status: evidence separation

| Category | Result |
|---|---|
| Current local Docker/PostgreSQL availability | **Checked once; unavailable.** Docker engine named pipe missing. No retry was made. |
| Existing temporary database identity | **Not inspected.** No database connection attempted after Docker failure. |
| Migration history table/current records | **Not inspected.** |
| Actual catalog effects for any migration | **Not inspected in this run.** |
| Staging/production state | **Not accessed.** No claim is made about current remote state. |
| A. Already verified applied | **None newly certified by this audit.** Earlier local reports are historical snapshots and must be re-identified/rechecked before reuse. |
| B. Confirmed pending | **None.** Cannot determine without exact target history/catalog. |
| C. Applied but history inconsistent | **None confirmed in this run.** |
| D. Unknown | **All 31 migration versions** for the current local database and any remote release target. |

The complete unknown version set is the 31 filenames in the inventory above, from `20261001000000` through `20261031180000`. A prior schema dump or migration filename is not live-state evidence.

## Proposed release sequence (not executed)

### Phase 0 — Establish a safe target and evidence bundle

1. Obtain explicit target identity through the operator's authorized process; separate staging from production and keep production untouched.
2. Take a verified, restorable database backup and record its timestamp/restore point. Confirm who can restore it and the rollback window.
3. Obtain read-only catalog snapshots: `server_version_num`; installed extensions; schemas/roles; tables/columns/defaults; constraints and validation state; indexes; triggers; function source/owner/`prosecdef`/`proconfig`/ACL; policies/RLS/force-RLS; table/column ACLs; default ACLs (global and schema); publication membership/columns; migration history.
4. Run read-only preflights for lowercased duplicate profile emails, duplicate organization owner IDs, registration OTP uniqueness, billing amount/status/timestamp/refund conflicts, payment identity conflicts, normalized lead duplicates, and all constraints about to be added. Resolve conflicts manually with an approved data plan; no automatic deletion or rewriting.

### Phase 1 — Reconcile history before apply

1. Compare each of the 31 migration effects with live catalog/data evidence individually. Record object-level proof and replay risks. Do not baseline a migration because a similar object exists.
2. If the remote history table is absent, preserve a backup and export the catalog baseline. Have a second reviewer approve the exact historical versions proven fully applied in substance. Create/use Supabase migration history only through the documented, version-pinned CLI process after that review; do not hand-create history tables or mark partially applied migrations as applied.
3. Explicitly distinguish a fully applied migration from partial effects. A partially applied migration needs a reviewed forward reconciliation script, not a blind repair status or replay.

### Phase 2 — Apply verified missing migrations in dependency order

The source-order sequence for genuinely missing migrations is the sorted 31-file order shown above. For the recent block, apply only after prerequisites and data preflights pass:

1. `20261030000000_owner_business_billing_details.sql`
2. `20261030120000_owner_csv_import_persistence.sql`
3. `20261031000000_onboarding_billing_integrity.sql`
4. `20261031120000_sanitized_lead_refresh_signals.sql`
5. `20261031130000_public_leads_privilege_hardening.sql`
6. `20261031140000_security_definer_search_path_hardening.sql`
7. `20261031150000_durable_email_otp_attempts.sql`
8. `20261031160000_organization_twilio_calling.sql`
9. `20261031170000_razorpay_atomic_subscription_lifecycle.sql`
10. `20261031180000_paid_subscription_entitlement_gate.sql`

This is **not** an instruction to apply all ten: apply only those individually confirmed missing and only after verified prerequisites. The chronology places durable email OTP after current auth schema; Twilio depends on call bridge schema; Razorpay lifecycle depends on billing foundation/onboarding integrity; entitlement must follow the lifecycle fields it reads.

### Phase 3 — Validate and observe

1. Use a disposable local Supabase/PostgreSQL 17 database with seed disabled and a unique project ID; preserve any existing user database. Do not use reset unless the target is confirmed disposable and empty.
2. Apply/reconcile one reviewed migration at a time; capture CLI output/exit status and verify exact catalog effects after each step.
3. Run each mapped SQL regression with PostgreSQL 17 `psql -X -v ON_ERROR_STOP=1 -f ...`; confirm final `ROLLBACK`, process exit 0, and zero fixture residue.
4. Add separate multi-session PostgreSQL tests for OTP attempt exhaustion/consume races, CSV/manual lead duplicate locking, and concurrent/replayed Razorpay webhook/payment application. The existing SQL files do not demonstrate those races with independent sessions.
5. Validate provider workflows separately in sandbox accounts: Razorpay test mode, Twilio test numbers/controlled callback routing, and server encryption-key rotation. SQL tests cannot establish provider configuration or network signature behavior.
6. After approval, repeat read-only staging preflights and apply only the reviewed pending set to staging. Verify migration history and catalogs. Keep production out of scope until a separate release approval, backup, and rollback plan.

## Rollback considerations

- Prefer forward fixes for applied schema; most changes have data, RLS, ACL, trigger, or publication effects that cannot be safely reversed by generic down migrations.
- The sanitized Realtime migration intentionally must **not** restore raw `public.leads` publication during rollback. A rollback must retain the privacy boundary.
- Do not drop OTP, billing, Twilio, lead, payment, or signal tables containing live customer state as an automatic rollback. Restore from backup only under an approved recovery procedure.
- `ALTER FUNCTION ... SET search_path` can be reversed only after reviewing the previous value and function body; do not restore vulnerable paths as a routine rollback.
- Privilege migrations need an exact ACL snapshot and approved rollback SQL; re-granting broad historical privileges is not an acceptable fallback.

## Release verification checklist

- [ ] Exact target project/database identity and PostgreSQL version confirmed without exposing secrets.
- [ ] Backup verified restorable; no production project selected.
- [ ] All 31 migration files compared individually with remote history and actual catalog.
- [ ] Duplicate/data compatibility preflights passed with results saved.
- [ ] Historical baseline set reviewed and approved per version; no partial migration falsely marked applied.
- [ ] Only individually confirmed pending migrations applied in dependency order.
- [ ] Function owners, SECURITY DEFINER flags, search paths and EXECUTE matrices verified.
- [ ] RLS policies, `public.leads` ACLs/column grants, default ACLs and Realtime publication columns verified.
- [ ] OTP atomicity, payment identity, refund ordering, Twilio tenant credentials and entitlement cases passed SQL checks.
- [ ] Independent-session concurrency tests passed for OTP, lead creation/import and payment/webhook races.
- [ ] All rollback SQL tests reached final ROLLBACK and left no fixtures.
- [ ] Application/provider sandbox E2E passed without enabling live checkout or real calls.
- [ ] Migration history exactly matches the migrations actually applied.

## Safe next action

Restore Docker Desktop if a local database validation is needed, then identify the existing disposable project and verify its identity before connecting. Because this run did not identify a database, do not run migration up, db push, reset, migration repair, or staging commands based on this audit alone. The immediate release blocker is missing current catalog/history evidence, not an inferred SQL change.
