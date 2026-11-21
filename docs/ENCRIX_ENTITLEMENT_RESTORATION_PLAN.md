# ENCRIX entitlement restoration plan

**Updated:** 2026-11-05 with operator-supplied Production security findings. No Production access or changes were made.

**Goal:** restore the database's authoritative organization entitlement result so an entitled owner can invite telecallers. **Status:** operator's latest preflight summary reports the entitlement RPC and required billing tables missing; no Production connection/write occurred. Full security catalog outputs are still required before write-script preparation.

## Invitation call path

`OwnerTeamPage` → auth service invite request → Vercel rewrite `/api/auth/:route*` → `api/auth-router.ts` selects `invite` → `api/_lib/authHandlers/invite.ts` authenticates and checks active `OWNER`/`ADMIN` plus server-resolved organization → `requirePaidEntitlement(res, profile)` → `checkPaidEntitlement()` calls `organization_has_active_paid_entitlement(p_organization_id = profile.organization_id)` through the server Supabase client → invitation DB/email work happens only after `true`.

The request body cannot choose the organization passed to the entitlement RPC or the invitation row. A missing/failed RPC or non-boolean response maps to HTTP 503 `PAID_ENTITLEMENT_UNAVAILABLE`; a valid boolean `false` maps to HTTP 402 `ACTIVE_SUBSCRIPTION_REQUIRED`; an inactive profile or missing organization is rejected with HTTP 403. No client entitlement value is trusted.

## Root cause and evidence level

The latest operator-supplied preflight summary reports `organization_has_active_paid_entitlement(uuid)`, `organization_subscriptions`, `billing_payments`, and `billing_webhook_events` absent. The exact database error code was not supplied, but with the function absent PostgREST cannot resolve the RPC; `checkPaidEntitlement()` catches the error and returns `unavailable`, which the API safely maps to 503 `PAID_ENTITLEMENT_UNAVAILABLE`. This is the confirmed root cause **according to the supplied current catalog summary**, not an independent live query by this agent. If the raw function result differs from the summary, retain a redacted error code/status and reconcile before acting.

The local application path and `requirePaidEntitlement` unit coverage are already present. A new invite-handler integration test covers missing-RPC safe 503, false/expired denial, active approval, active telecaller rejection, and organization ID derivation from the authenticated profile. This validates application wiring with synthetic RPC responses; it does not validate PostgreSQL function semantics.

## Minimum candidate order and current blockers

The source-level dependency order for paid entitlement is:

1. Reconcile migrations `010`, `010001`, `060`, `070`, `080`, and intervening `120`–`220` by catalog effects. The latest summary proves some 070/080 effects exist but omits required invitation/phone OTP, email-constraint, RLS/policy, and security details. Do not replay either 070 or 080 wholesale. Prior operator verification reports durable email OTP state present despite its migration history not being recorded; recheck exact body/ACL before history reconciliation.
2. Migration `230` billing foundation. The three created tables are reported absent, so its table-attached constraints, indexes, RLS and policies cannot be present on those tables. However, current table-grant/RLS result sets and prerequisite role/UUID extension confirmation must be reviewed. Source has non-idempotent `CREATE` statements and no explicit transaction boundary.
3. Migration `300` business details. Its four added columns and two named indexes are reported absent; normalized-email and owner duplicate counts are zero. Verify existing base column types and prerequisites and review full policies/ACL results. The migration is not transaction-wrapped.
4. Migration `310` onboarding/billing integrity. Registration table/column/RPC/trigger effects are reported absent, and billing constraints cannot attach while billing tables are absent. It changes OTP/owner-registration semantics, creates a payment trigger, and drops `record_registration_otp_failure(uuid,text)`. The latest function output did not say whether this drop target exists; check exact signature and dependencies. Do not prepare/replay until this conflict is resolved.
5. Migration `311700` payment lifecycle. Its tables and RPC are reported absent, so table alterations/index/constraints and its apply-payment RPC effects are absent by dependency. It requires 230 and 310, adds a defaulted refund amount column and validates checks; verify all preconditions before staging.
6. Migration `311800` paid entitlement gate. Function is reported absent; apply only after every predicate dependency from 230/310/311700 matches source and the exact function signature is confirmed absent.
7. Pilot migration `411` is optional and unnecessary to restore verified-paid entitlement. It creates grant/revoke capability and replaces the paid RPC to allow active pilot rows. Do not enable `FOUNDING_PILOT_GRANTS_ENABLED`, issue grants, or execute this migration as part of paid entitlement recovery.

These are **candidate dependencies, not approvals or execution scripts**. No migration-specific Production write file was prepared: full current RLS, policies, grants/default ACLs, index/constraint definitions, and intervening security migration results were not included in the supplied summary, so complete effect reconciliation is not yet achieved.

Do not apply Twilio migration 311600; it is not an entitlement dependency. Do not use `supabase db push`, bulk replay, or manual history edits. Reconcile history only after effects are independently proven and separately reviewed.

## Postflight acceptance

- Expected versions have reviewed, justified history state; no synthetic migration rows.
- Tables/columns/types/defaults/nullability/constraints/indexes match source exactly and are valid.
- Paid RPC signature is `(p_organization_id uuid) RETURNS boolean`, is `SECURITY DEFINER` with `search_path=pg_catalog, pg_temp`, references schema-qualified tables, and grants EXECUTE to service_role only; compare exact definition to migration.
- Billing RLS is enabled, app roles have no direct access, service_role permissions match intended access, and the payment identity trigger matches 310.
- Under disposable/staging fixtures: verified active ₹9,999 annual payment grants; pending/unpaid, inactive, expired, refunded-in-full, malformed plan and mismatched organization payment deny; valid paid current-period partial refund follows the migration's rules; wrong role/inactive profile and cross-org IDs deny.
- Invitation remains absent and no email sent for a missing RPC, false entitlement, wrong role, or invalid organization. Active result continues to insertion/email using the authenticated organization only.

## Exact next Production action

The eight checks have been run, but only summarized findings were supplied. Next, provide the complete redacted outputs for `ENCRIX_PREFLIGHT_RLS_POLICIES.sql` and `ENCRIX_PREFLIGHT_FUNCTIONS_PERMISSIONS.sql`, the complete `ENCRIX_PREFLIGHT_INDEXES_CONSTRAINTS.sql` and `ENCRIX_PREFLIGHT_TRIGGERS.sql` results, and the full 34-version history query. The history and function-permission queries have since been expanded; rerun those read-only files and include unexpected same-name overloads plus `record_registration_otp_failure(uuid,text)`. The combined read-only postflight query is [ENCRIX_BILLING_POSTFLIGHT.sql](sql/ENCRIX_BILLING_POSTFLIGHT.sql). No further Production write is appropriate before that reconciliation.

After full reconciliation and disposable/staging validation, I can prepare one guarded execution artifact per proven-missing migration. A Production write would still require your explicit approval. No write script is included at this stage because the assignment explicitly prohibits generating one before complete source/effect reconciliation.

## Local verification

- Full Vitest suite: 86 files, 947 tests passed.
- Targeted entitlement/invitation/migration-contract suite: 4 files, 30 tests passed.
- Final reconciliation-focused rerun after updating the catalog queries: 8 files, 65 tests passed (`billing_preflight_contract`, invite entitlement, paid entitlement, 170000/180000 lifecycle and gate contracts, pilot migration contract, and pending migration preflight contract).
- `npx tsc --noEmit`: PASS. `git diff --check`: PASS (Git emitted existing line-ending conversion notices).
- Production build and both TypeScript checks passed; bundle-size advisory remains.
- Lint exited 0 with existing Oxlint warnings; `git diff --check` exited 0 with existing line-ending notices.
- No PostgreSQL parser/client was available locally, and neither SQL file was executed. No staging database session was used; database RPC behavior remains to be validated in isolated staging before any Production write.
- The current migration inventory is 34 files; older documents reporting 33 are superseded by the repository inventory.
- No Production execution file has been prepared; read-only preflight/postflight SQL remains separate from write migrations.

## Security findings and pre-migration gate — 2026-11-05

The latest operator report says only the first two migrations are recorded; remaining 32 are not. The durable email OTP objects are present despite their missing history entry. This confirms that version history cannot be used as replay authorization. The Production CSV omitted its trigger result section, so trigger state remains unknown until the new [standalone inventory](sql/ENCRIX_PRODUCTION_TRIGGER_INVENTORY.sql) is run.

### Privilege design for billing

The source billing foundation enables RLS and revokes PUBLIC/anon/authenticated table privileges, then currently grants ALL to service_role and adds service-role-only `FOR ALL` policies. That is server-only and avoids direct authenticated tenant access, but service_role is a cross-tenant trusted backend role and bypasses RLS; tenant scope must be enforced in the server handler/RPC, not inferred from that policy. No billing sequence is created because primary keys use UUID defaults.

Observed direct API operations support a narrower target: `organization_subscriptions` SELECT/INSERT/UPDATE; `billing_webhook_events` SELECT/INSERT/UPDATE; `billing_payments` SELECT only (the atomic SECURITY DEFINER RPC writes payment records). No direct anon/authenticated/PUBLIC access. Validate all call sites before any source change. Do not expose raw billing tables to authenticated clients; if a customer UI later needs billing details, add a reviewed org-scoped sanitized view/RPC with explicit grants and tests.

Production reports broad public-schema defaults. Migration 311300 only changes schema-specific defaults for creator `postgres`; it checks and aborts for specific unsafe global defaults. Defaults apply by object creator, so its effects do not protect objects created under another role. Obtain each effective creator and its global/schema ACLs before using that migration. PostgreSQL's default PUBLIC EXECUTE on newly created functions is global; every sensitive billing RPC must explicitly REVOKE PUBLIC/anon/authenticated, then grant only its intended backend role. Current billing RPC migrations do this. The 310 payment identity trigger function does not explicitly revoke function EXECUTE; add that as a reviewed migration-source correction before any future execution. Because 230 is not explicitly transaction-wrapped and 310 also has multi-statement DDL, transaction-bound reviewed execution is required to avoid partially applied objects and transient broad defaults.

### RLS interpretation and helper paths

Reported broad table grants do not alone prove rows are accessible. Enabled RLS filters ordinary roles by applicable policy; no policy means default deny for row access. However, permissive policies OR together, and table owners/superusers/BYPASSRLS roles can bypass RLS when not forced. The current report says inspected tables have RLS enabled but not forced; it does not provide enough per-table owner/role/policy detail to prove effective access. `lead_assignments`, `messages`, and `user_sessions` have no listed policies: treat them as default-denied to API roles until their server-side paths are verified, not as a reason to add broad policies.

The helper functions `get_auth_profile`, `get_auth_role`, and `get_auth_org_id` are SECURITY DEFINER with `search_path=public, pg_temp` in the 190/220 migration lineage. Version 220 uses schema-qualified `public.profiles`, `auth.uid()`, and qualified helper calls. `is_caller_active` similarly delegates to the qualified active-profile helper and is later hardened by 311400 to `pg_catalog, pg_temp`. `prevent_audit_tampering` is SECURITY DEFINER with `public, pg_temp` after 190 and has no relation/function references in its body. Verify owners, live path, and effective CREATE privilege on public before approval; 180 revokes CREATE from PUBLIC/anon, but current ACL/membership must be checked. Do not replay any of these security migrations based only on history.

### Minimum safe next steps

1. Run the full final audit plus trigger inventory on the confirmed Production project and return complete redacted result sections. Confirm per-table effective privileges/RLS bypass, public schema CREATE, default ACLs per creator, all function owners/overloads/EXECUTE, and target triggers.
2. Compare each finding against migration source; resolve creator-role/global-default conflicts before candidate migration review. Do not apply 311300 blindly; its preflight intentionally aborts on some global-default states.
3. Prepare a reviewed source correction for explicit EXECUTE revokes on `protect_billing_payment_identity()` and a least-privilege replacement for the billing foundation's service_role ALL grants, subject to call-site tests.
4. Validate the full chronological chain on a disposable PostgreSQL 17 Supabase-compatible instance using synthetic roles/data and the actual default-ACL fixture. Exercise failure/rollback, direct role access, function ACL/path, organization isolation, and active/inactive/expired/refund entitlement cases.
5. Only after the above, prepare separate per-migration write artifacts. No Production SQL, permissions, migration history, OTP behavior, or application permissions have been modified here; no write scripts have been prepared.
