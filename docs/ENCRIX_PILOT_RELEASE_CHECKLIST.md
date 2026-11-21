# ENCRIX founding pilot release checklist

Use this checklist for the reviewed candidate and each of the three pilot organizations. Mark each item with owner, date, evidence link/ID, and result. Do not mark source inspection or mocked tests as production verification.

## Before customer access

- [ ] Review complete existing working-tree diff; preserve unrelated/user-owned changes and exclude secrets, `.env*`, database backups, temporary dumps, and local test fixtures from the release artifact.
- [ ] Run `npm test -- --maxWorkers=2`, `npm run build`, `npx tsc --noEmit`, `npx tsc --noEmit -p tsconfig.api.json`, `npm run lint`, and `git diff --check`; save exact exit codes and warnings.
- [ ] Confirm production and staging Vercel project/environment scopes without printing secrets. Server-only keys must not be `VITE_` variables or appear in `dist`.
- [ ] Confirm `VITE_ENABLE_DEMO_SANDBOX` is not `true` in Production; production builds now fail closed if it is explicitly enabled. Keep demo personas and demo records out of customer sessions.
- [ ] Confirm Supabase backup/PITR coverage and tested restore ownership before any approved SQL write.
- [ ] Complete version-by-version production schema reconciliation. Do not infer schema from migration history, blindly replay, run `db push`, or fabricate history.
- [ ] Review OTP preflight output and the exact forward repair; complete the separately approved SQL procedure in `ENCRIX_FOUNDING_PILOT_PLAN.md` only after target/backup sign-off.
- [ ] Verify OTP post-repair catalogs, RPC definition/owner/search path/grants, table RLS, and UUID default/extension resolution using the named read-only verification scripts.
- [ ] Execute OTP, entitlement, and tenant SQL regression tests against a disposable Supabase-compatible database. Prove OTP attempt limits with concurrent sessions.
- [ ] Run staging E2E for owner registration/login, invitation/telecaller login, lead CRUD/import/assignment/persistence, call outcome history, dashboard counts, cross-tenant denial, session expiry and logout.
- [ ] Keep the call-history/outcome UI out of the live pilot promise unless a server-backed list/write path and reload persistence tests have been verified. Current call pages use client-side `db` arrays.
- [ ] Confirm non-admin grant/revoke is rejected, admin identity is checked both at the API and database boundary, expiry is enforced, duplicate grant is rejected, event audit writes are durable, and active pilot cap is three.
- [ ] Keep `BILLING_PLAN_DRAFTS.business.checkoutEnabled` false, `TWILIO_CALLING_ENABLED` not true, and `ENABLE_FOLLOWUP_EMAIL_REMINDERS` not true for pilot release. No live checkout or provider sends.
- [ ] Keep `FOUNDING_PILOT_GRANTS_ENABLED=false` until the migration and tests are reviewed and an approved operator change enables pilot administration.
- [ ] Verify approved customer terms, ₹9,999/12-month invoice/payment workflow, privacy notice, support contact, data retention, and incident owner. No customer activation without the separate entitlement approval process.
- [ ] Confirm rollback owner, previous immutable deployment, and forward-fix/database restore process.

## Per-organization readiness

- [ ] Written pilot agreement and 12-month scope acknowledged.
- [ ] Payment/invoice evidence independently checked by authorized staff; reference recorded in approved accounting system.
- [ ] Organization and active owner identity confirmed; test account removed/disabled if used.
- [ ] Pilot entitlement grant reviewed by active platform ADMIN, has correct organization, reason, and explicit expiry; event row verified read-only. Do not store bank/card data in the reason.
- [ ] Owner completes login, organization details, one test lead, and owner dashboard check.
- [ ] Telecaller invitations go only to approved addresses; each caller has separate account and least privilege.
- [ ] Customer CSV passes import checklist and contains only the agreed fields/consented records.
- [ ] Customer is shown calling automation, reminder emails, Razorpay checkout, and unfinished features are unavailable during pilot.
- [ ] Support path and feedback sessions are scheduled.

## Production smoke after separate deployment approval

- [ ] Website loads over HTTPS; health/API and static assets return expected results.
- [ ] Existing approved test owner can log in; invalid/expired OTP is rejected without revealing account existence beyond the designed response.
- [ ] Owner/telecaller role and organization boundaries hold at API level; tampered organization/lead IDs disclose no foreign data.
- [ ] Lead created/edited/assigned by owner remains after reload and appears only in the assigned telecaller queue with permitted projection.
- [ ] Call history/outcome persistence is verified server-side before being advertised; otherwise use the customer's approved external call log. No Twilio provider request occurred.
- [ ] Dashboard totals are organization-scoped.
- [ ] Session expiry and logout revoke access and clear client state.
- [ ] Error responses are actionable and generic; server logs do not include OTP, tokens, full lead contact data, raw webhook bodies, or secrets.
- [ ] Pilot entitlement expiry and revoke are verified using an isolated staging fixture; no production expiry manipulation.

## Stop conditions

Stop customer onboarding on OTP/RPC errors, unverified schema/grants, cross-tenant data, owner/telecaller privilege confusion, lead persistence failure, token surviving logout, unexpected outbound email/call/payment, duplicate pilot activation, missing audit event, or server errors containing secrets/customer data. Record the issue using `ENCRIX_CUSTOMER_ONBOARDING.md`'s support template.
