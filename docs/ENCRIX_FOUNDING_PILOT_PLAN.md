# ENCRIX founding pilot plan

**Pilot cohort:** up to three businesses

**Commercial offer:** ₹9,999 per organization for 12 months
**Release posture:** limited core CRM pilot; production access stays blocked until the OTP repair, database reconciliation, and security verification gates below are signed off.

## Pilot scope

Deliver owner registration/login by email OTP, one organization per owner, active-owner telecaller invitations/login, server-backed leads and assignment, status tracking, and basic organization dashboards. Source inspection found call pages/outcome entry read and write the client-side `db` arrays; this audit did not find a verified server persistence path for manual outcomes/history listing. Exclude those functions from the live pilot until a server-backed path and reload tests are implemented. Preserve server-side role and organization checks on every route. Do not promise calling automation, automated reminder email, checkout, advanced analytics, or any mock-only capability as a production feature.

## Entitlement decision

Current `organization_has_active_paid_entitlement(uuid)` is the single server-side authority used by paid CRM routes. It only accepts a current Business subscription supported by a captured, signature-verified Razorpay payment. There is no offline founding-pilot route. A pilot grant is therefore needed if the three pilot organizations will be activated after an independently verified invoice/manual payment while Razorpay checkout remains closed.

The local candidate migration `supabase/migrations/20261104120000_founding_pilot_entitlements.sql` extends that same RPC with a second, explicit source: a grant tied to one organization, expiration no later than 365 days, active platform ADMIN grant/revoke RPCs, serialized capacity for no more than three active pilot organizations, and append-only grant/revoke events. It does not change the existing Razorpay verification requirements. `POST /api/pilot-entitlements` authenticates an active ADMIN before calling those server-only RPCs; the database independently verifies the actor role. Owners, telecallers, and browser clients cannot grant or inspect records directly.

**Activation status:** not activated. `FOUNDING_PILOT_GRANTS_ENABLED` defaults to `false`; the API rejects all grant/revoke operations unless an operator-reviewed environment explicitly enables it. No grant records exist by virtue of this code change, and the migration has not been executed. Even with the flag enabled, the endpoint fails closed until its RPCs exist. Do not enable the flag, apply the migration, or grant any production pilot until migration review, SQL regression execution in a disposable Supabase-compatible database, and production change approval are complete. The audit reason should identify the operator-reviewed invoice/reference or approved pilot exception without storing sensitive payment details.

## OTP production repair procedure

The reviewed repair is a transactional, fail-closed forward repair for migration `20261031150000_durable_email_otp_attempts.sql`. It intentionally does not insert migration history. It assumes the exact nine-column `email_otps` base from migration 080000 and refuses to overwrite existing durable columns, index, or RPCs.

1. An authorized database operator independently confirms the Supabase project reference in the SQL Editor and records the expected production target. Take/verify a restorable backup and restore owner first.
2. Run the read-only `supabase/tests/diagnose_production_identity_history.sql`, `supabase/tests/diagnose_email_otps_catalog.sql`, and `supabase/tests/preflight_production_durable_email_otp_single_result.sql`. Save outputs without customer rows or secrets. Confirm target identity, base table contract, RLS/service-only policy, UUID default/extension resolution, required roles, missing exact migration version, and absence of conflicting partial objects. Resolve every `UNKNOWN`, `CONFLICTING`, or unexpected-present result before proceeding.
3. Review the exact candidate `supabase/tests/repair_production_durable_email_otp.sql` against migration `20261031150000_durable_email_otp_attempts.sql`. It obtains an exclusive table lock, takes one transaction, adds only the durable columns/index/RPCs, checks grants/search paths/definitions, and commits only if all assertions pass. It does not record migration history.
4. Only after a separate approval, run that script **once** in the independently confirmed production SQL Editor. Do not run `supabase db push`, do not paste it into another target, and do not manually insert migration history. Stop on any exception and retain the redacted error.
5. Run read-only `supabase/tests/verify_production_durable_email_otp.sql` and `supabase/tests/verify_production_email_otps_uuid_default.sql`. Confirm all expected columns/index/RPCs/security/grants/base policy and extension resolution. Then have the database owner reconcile whether migration 31150000 is semantically applied and record history only through the separately reviewed migration-reconciliation procedure; do not edit history ad hoc.
6. Deploy the matching reviewed application code only after database state is verified. In staging first, run owner and invitation OTP issue/delivery, resend cooldown, wrong-code attempts, expiry, replay, login/session/logout/expiry and concurrent-attempt tests. Never log OTP values.

This procedure is prepared, not executed. Database identity and object states need live operator evidence.

## Release gates

1. Complete OTP SQL repair review and staging E2E; confirm production migration/RPC/grants with read-only verification.
2. Reconcile all production migrations and confirm exact RLS/function/ACL definitions; the prior project notes report two recorded and 31 unrecorded versions, but do not infer missing schema from history alone.
3. Run tenant isolation tests with two organizations and owner/telecaller accounts, including tampered IDs, unassigned leads, exports, call history and reports.
4. Confirm lead creation/edit/assignment survives reload and remains organization-scoped; verify CSV failure handling and import boundaries.
5. Verify session expiry/logout clears browser state and all protected APIs reject expired/revoked sessions.
6. Verify generic safe server errors and redacted logs. Do not include provider/database internals in responses.
7. Run full local tests/build/type/lint/diff checks and review the complete release diff. Resolve warnings that indicate behavioral risk.
8. Keep Razorpay checkout closed, Twilio live calling disabled, and follow-up email sending disabled. No live provider test or production write without separate approval.
9. After the authorized operator confirms invoice/payment evidence, activate at most three pilot entitlements only after the migration and tests have been reviewed and applied under a separate approved database change.

## Operating model and cost controls

Use the existing Vercel deployment and Supabase project for the limited cohort. Avoid adding queues, worker services, analytics vendors, or always-on infrastructure for pilot features. Keep reminder email dispatch off and use manual owner follow-up. Keep Twilio off and use customer-controlled manual calling with call outcome entry only where that path is confirmed persistent. Monitor existing Vercel/Supabase logs and health checks with redacted identifiers. Establish per-organization owner contact and a manual incident contact path. Do not claim provider-level SLA, recording, or automation without verification.
