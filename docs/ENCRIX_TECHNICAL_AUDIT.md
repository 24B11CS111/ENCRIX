# ENCRIX technical audit

**Prepared:** 2026-11-04. **Scope:** local repository/source review. No Production connection, SQL execution, Vercel setting change, credential access, deployment, or provider transaction was performed.

## Database/provider validation update — 2026-11-06

Docker Desktop is installed, but the daemon is not running; the existing PostgreSQL process on port 5432 was left untouched. A separate staging Supabase project is referenced by local configuration but was not contacted. The full 41-migration chain, all 16 SQL regressions, persistent CRM E2E, provider Test Mode and backup/restore remain unexecuted in this follow-up. No Razorpay Test Mode bundle was available, and Twilio Test Account status could not be verified. No Production activity occurred. See [ENCRIX_COMPLETE_AUDIT.md](ENCRIX_COMPLETE_AUDIT.md) for exact evidence and blockers.

## Architecture observed

- React + TypeScript frontend built with Vite; server endpoints run as Vercel Node functions.
- Frontend Supabase access uses the anon key and is governed by Supabase policies. API routes use a server-only service-role client and must enforce identity, role, and organization scope themselves.
- OTP and signed server sessions are implemented in API helpers. Lead, invitation, follow-up, telephony, billing, and entitlement flows are split across server route/helper modules.
- PostgreSQL schema/security behavior is migration-managed under `supabase/migrations`; local SQL checks and contract tests are under `supabase/tests` and `src/test`.
- The working tree contains substantial preexisting user changes. This pass preserved those changes; current working-tree status is not a clean baseline and no broad reformat/rewrite was attempted.

## Confirmed release findings

1. Owner invitation and other protected CRM routes call `requirePaidEntitlement`, which asks `organization_has_active_paid_entitlement(p_organization_id)` using the authenticated profile's organization. Missing/error/non-boolean RPC results return HTTP 503 `PAID_ENTITLEMENT_UNAVAILABLE`; false returns 402. This is fail-closed and must not be bypassed.
2. The operator-reported Production preflight found the billing subscription/payment/webhook objects and entitlement RPC absent, with billing and pilot migrations unrecorded. This audit did not re-query Production. The reported missing RPC/schema is therefore the supported cause of the invitation error, pending fresh catalog evidence and approved database recovery.
3. The paid gate migration accepts only verified active Razorpay subscriptions. The founding-pilot migration adds an organization-scoped expiring grant path to the same RPC, with active platform-admin authorization, three-active-organization cap, revoke path, and audit events. It is not active until migration is reviewed/applied and the admin API feature flag is explicitly enabled.
4. Checkout is disabled in the plan catalog. Pilot API administration is disabled unless `FOUNDING_PILOT_GRANTS_ENABLED=true`. Twilio calling and automated follow-up email dispatch require explicit server flags; leave them unset/false for the pilot.
5. Frontend production build validation already required canonical Supabase URL/key and the production project reference. This pass additionally rejects `VITE_ENABLE_DEMO_SANDBOX=true` in production builds; development and staging remain unchanged.
6. Pilot matrix excludes call-history and manual-outcome claims until the server-backed persistence path is verified. Mock/demo behaviors must not be represented as customer data.

## High-priority evidence still required

- Reconcile every migration effect against current Production catalogs, data, policies, ACLs, triggers, and function bodies; history rows alone do not prove schema state.
- Use disposable PostgreSQL 17/Supabase-compatible staging to validate migrations and SQL regressions, then run tenant/role and persistence E2E with two synthetic organizations.
- Verify OTP issue/verify/expiry/replay, server session expiry/logout, lead create/edit/assignment/reload, and safe server errors/logs.
- Verify deployed Vercel build, environment scopes, function inventory, runtime health, and redacted OTP logs after separately approved release steps.

See [security audit](ENCRIX_SECURITY_AUDIT.md), [database migration plan](ENCRIX_DATABASE_MIGRATION_PLAN.md), [production readiness](ENCRIX_PRODUCTION_READINESS.md), and [pilot checklist](ENCRIX_PILOT_RELEASE_CHECKLIST.md).
