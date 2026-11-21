# ENCRIX security audit

**Date:** 2026-11-06. **Scope:** read-only static review of the current working-tree source and existing SQL/test artifacts. Production/staging catalogs, logs, credentials, and accounts were not accessed.

## Status of requested follow-up review

The requested read-only static review completed on 2026-11-06. It reported no confirmed vulnerabilities in the reviewed changes. High-impact areas reviewed without findings included authentication, OTP/session revocation, tenant-scoped service-role access and RLS/RPC grants, billing entitlements/refunds/webhooks, Twilio credentials/callback signatures/recording access, CSV input, and sensitive-data exposure. This is not proof that the application or its deployed environment is secure; no live exploit was attempted and no deployed catalog or provider configuration was checked.

## Assessment

**Security release status: NO-GO pending database reconciliation and staging verification.** This is not a finding that a live cross-tenant exploit was reproduced. The current system uses a Supabase service-role client in server APIs, which bypasses RLS. Tenant safety therefore depends on correct server identity/role/org derivation plus deployed function ACLs, RLS, triggers, and views. Those deployed properties remain unverified.

## Confirmed vulnerability findings

No confirmed exploitable vulnerability was reported by the static review of the current working tree. This is a source-review result only; it does not resolve the database, staging, provider, or deployment verification risks below.

## Database/provider validation update — 2026-11-06

No persistent database or provider operation was performed in the follow-up sprint. Docker Desktop is installed but its daemon is unavailable; a separate staging Supabase URL is configured locally, but was not contacted. An unidentified PostgreSQL process on port 5432 was left untouched. Razorpay Test Mode credentials were not configured; local Twilio credentials were not verified as belonging to a Test Account. Accordingly, no RLS/grant/concurrency behavior, tenant isolation against PostgreSQL, webhook lifecycle, or provider security was verified dynamically. The release remains **NO-GO** pending isolated database and approved provider/staging evidence.

## Controls present in source

- Login/invitation OTP handlers require durable database ticket state; verification uses an atomic RPC and fails closed when state/RPC operations fail. Registration follows its own ticket/transaction path.
- API handlers authenticate server-side and use profile role/status/organization checks. Owners and telecallers have distinct lead access paths.
- SQL migrations define service-only RPCs/tables, active-profile policies, sanitized telecaller projections, lead write guards, and search-path restrictions for selected `SECURITY DEFINER` functions.
- Organization Twilio credentials are stored as encrypted envelopes using AES-GCM/key IDs in source; provider credentials are not intended for browser output.
- Razorpay payment activation is designed around server-side configuration/signature/webhook verification and database lifecycle operations; checkout is currently disabled.
- Production Vite builds now fail if `VITE_ENABLE_DEMO_SANDBOX=true`; the frontend still supports demo mode in development/staging when explicitly selected.
- Local tests cover OTP, invitation, tenant lead reads, callback signature rejection, Twilio credentials, billing webhooks, and selected migration contracts.

These are source-level controls, not proof of production enforcement.

## Open risks / required verification

| Risk | Evidence needed before release |
|---|---|
| OTP RPC/schema/grant drift | Compare `20261031150000` to production catalog; verify `email_otps` columns, unique ticket index, function definitions/owners/search paths, effective EXECUTE grants, service-role table access, and atomic attempt/consumption behavior. Test missing/expired/wrong/replayed OTP and concurrent attempts in staging. |
| Tenant bypass through privileged API | Exercise every owner/telecaller endpoint with same-tenant, wrong-role, inactive-profile, unassigned-lead, and cross-tenant identities. Verify server-derived org IDs and response projections. Query deployed RLS and effective ACLs. |
| SQL `SECURITY DEFINER` drift | Compare every body, owner, `proconfig`, and ACL against source; verify fixed search path and trusted schema qualification. Name-only matches are insufficient. |
| CSV export/import exposure or abuse | Verify server organization scope, no telecaller export route, import size/row limits, validation, deduplication/idempotency, and org-scoped persistence under staging fixtures. |
| OTP/session/email secrets | Confirm server-only environment scope, strong independent OTP/session secrets, rate controls, masked logs, token/session expiry and revocation. Never include OTP, hash, authorization header, or full phone/email in logs. |
| Twilio callback forgery/replay | Verify exact public URL/signature validation, organization binding, call SID idempotency/monotonic state, and duplicate/out-of-order callbacks with provider Test Account. Keep live calling disabled until verified. |
| Razorpay forged/replayed events | Verify raw-body HMAC, event ID idempotency, duplicate/out-of-order/refund behavior, amount/currency/plan validation, and atomic subscription update in Test Mode. Keep checkout disabled until verified. |
| Data in Realtime | Confirm deployed publication excludes raw leads and emits only intended sanitized refresh signals; verify authorization of each follow-up fetch. |
| Environment/secret exposure | Check Vercel scopes without printing values; ensure no server key uses a `VITE_` name and no secret is bundled into `dist`. Review deployment artifacts and logs. |
| Demo sandbox accidentally enabled in production | Build validation now rejects the explicit `VITE_ENABLE_DEMO_SANDBOX=true` value in production mode. Verify Vercel build inputs by name/scope and confirm the deployed artifact came from this code. |

## Severity and disclosure

The primary confirmed release risks are database drift/unknown deployed grants, the unverified OTP fix deployment path, and unknown billing schema/entitlement state. The supplied production finding “two recorded migrations / 31 unrecorded” is a history-state report and does not itself prove missing security DDL. No secret values were printed or copied into audit documentation. No live account was accessed and no exploit attempt was made.

## Required security sign-off

Before release, obtain reviewed evidence for effective grants, policies, `SECURITY DEFINER` definitions, publication scope, tenant isolation, OTP concurrency/expiry/replay, webhook signature/idempotency, Vercel secret scopes, and redacted error/log handling. Refer to [database reconciliation](ENCRIX_DATABASE_RECONCILIATION.md) and [production test plan](ENCRIX_PRODUCTION_TEST_PLAN.md).
