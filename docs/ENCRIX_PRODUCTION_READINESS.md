# ENCRIX production readiness

**Release decision: NO-GO for customer activation at this time.** This is based on operator-provided Production preflight findings and local source review, not a live Production query performed by this audit.

## Gate status

| Gate | Status | Evidence / exit condition |
|---|---|---|
| Production Supabase environment validation | Source PASS; deployed config unknown | Backend requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; frontend build requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Production project ref is pinned in source. Verify Vercel scopes without exposing values. |
| Demo sandbox | Source PASS after this pass | Production Vite builds reject `VITE_ENABLE_DEMO_SANDBOX=true`; redeploy required for change to take effect. Confirm deployed artifact uses this code. |
| Owner/telecaller authentication and OTP | BLOCKED pending verification | Durable OTP repair/migration and provider delivery must pass controlled issue, wrong-attempt, expiry, replay, resend and session/logout tests. |
| Organization/role isolation | NOT VERIFIED in deployed environment | Run synthetic cross-org and wrong-role tests across every server route; inspect production RLS, grants, triggers and security-definer functions. |
| Leads and assignment persistence | CONDITIONAL | Staging create/edit/assign/reload and tenant boundary tests must pass before customer import. |
| Invitation and paid entitlement | BLOCKED by reported DB gap | Production was reported missing billing tables and `organization_has_active_paid_entitlement(uuid)`. Keep `requirePaidEntitlement` fail closed; reconcile schema and migrate only under approved change plan. |
| Pilot grants | DISABLED / NOT MIGRATED | Review and validate migration/tests first. Keep `FOUNDING_PILOT_GRANTS_ENABLED=false`; grant only through approved operator workflow after migration verification. |
| Razorpay checkout | DISABLED | `checkoutEnabled=false`; source currently restricts to test-mode configuration. No live payment path is approved. |
| Automated Twilio calling | DISABLED | Keep `TWILIO_CALLING_ENABLED` false/unset; do not test against real customers. |
| Automated follow-up emails | DISABLED | Keep `ENABLE_FOLLOWUP_EMAIL_REMINDERS` false/unset until scheduler, outbox migration and delivery safety are verified. |
| Call history/manual outcomes | EXCLUDED | Pilot matrix records no confirmed server-backed persistent flow. Do not advertise as available until staging evidence exists. |
| Backups/rollback | REQUIRED | Verify restorable backup and recovery owner before any production SQL change. |

## Release sequence

1. Review the final source diff; verify no secret, dump, generated test fixture, or staging SQL export enters the release artifact.
2. Confirm Vercel Production variables by name/scope only and confirm `SUPABASE_URL` plus VITE URL point to `wrzoqxesffbfirjgotbr`; never print values. Ensure demo, Twilio, follow-up-email, and pilot-admin flags are off.
3. Finish read-only schema/data/ACL preflight and migration-by-migration reconciliation. Confirm a restorable backup. Review exact SQL and impact before seeking separate approval to write.
4. Validate the planned migration sequence and SQL tests on a disposable PostgreSQL 17/Supabase-compatible database, then staging. Resolve conflicts without blind push/history edits.
5. Run staging E2E for OTP, owner setup, invitation, telecaller access, leads, assignment, tenant isolation, session expiry/logout, and error/log redaction.
6. Obtain explicit approval for any Production SQL, Vercel setting change, or deployment. Verify each approved change with read-only postchecks and controlled smoke tests.
7. Onboard no more than three pilot organizations only after every mandatory gate passes and the approved entitlement/invoice process is in place.

## Non-actions

No Production SQL or settings were changed, no credentials were accessed/rotated, no deployment occurred, and no customer payment or provider contact was made.
