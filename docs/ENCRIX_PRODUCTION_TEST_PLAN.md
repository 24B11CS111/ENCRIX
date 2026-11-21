# ENCRIX production smoke-test plan

Use a dedicated approved test account/organization and isolated leads. Do not perform provider writes in production without separate approval. Use staging and provider sandbox for OTP, calls, and payments. No tests below were run against production in this audit.

| # | Workflow | Safe location | Preconditions / evidence |
|---:|---|---|---|
| 1 | Open `https://encrix.vercel.app`; check page load, console, network, health and static assets | Read-only production smoke after authorization | Operator access to browser/Vercel; redact logs. Site could not be fetched by this audit environment. |
| 2 | Owner registration and organization setup | Staging only | Dedicated email, Resend sender, reconciled auth/registration migrations; inspect only redacted status/events. |
| 3 | Owner email OTP issue, delivery, resend cooldown, wrong attempts, expiry, replay rejection, login | Staging only | Durable OTP migration and grants reconciled; dedicated inbox; verify atomic attempt counter with isolated concurrent requests. Never record OTP. |
| 4 | Session persistence, refresh, unauthorized request, logout, expiry | Staging; production read-only account check only | Dedicated test profile; confirm expired/revoked session cannot access protected API. |
| 5 | Owner invitation and telecaller onboarding/authentication | Staging only | Dedicated test org and recipient; verify invite one-time use, expiry, org binding, and role. |
| 6 | Create/edit/delete lead; status, notes, search/filter/pagination | Staging only | Synthetic test lead only; verify server persistence and role boundaries. No production customer data. |
| 7 | CSV import, duplicate handling, retry/idempotency; CSV export | Staging only | Synthetic CSV with unique test IDs; verify row validation, organization scoping, and no telecaller raw export. |
| 8 | Assign/reassign leads; telecaller assigned queue and unauthorized unassigned/cross-tenant lead access | Staging only | Two organizations, owner and telecaller for each; expect denial/empty sanitized result for all foreign records. |
| 9 | Outbound/inbound calling and call outcomes/history | Twilio Test Account only | Migration reconciled, approved test numbers, verified public webhook URL/signature; test one call at a time, callbacks, duplicate/out-of-order status, duration and cleanup. Never call real customers. |
| 10 | Follow-up creation/reminders/email outbox | Staging only | Cron secret and email test sender configured; validate timezone, duplicate suppression, retry, authorization at send/claim. |
| 11 | Dashboard counts, analytics, realtime updates and logout cache clearing | Staging only | Verify owner/telecaller totals after fixture mutations and no stale/cross-org data after logout/account switch. |
| 12 | Subscription status and payment history | Staging/Test Mode only | Billing migrations verified; approved Razorpay Test Mode plan and keys. |
| 13 | Checkout, payment signature, webhook capture, duplicate/replay/out-of-order/failure/refund | Razorpay Test Mode only | Explicit test-payment approval; verify amount/currency/plan server-side and entitlement only after verified database transaction. No live charge. |
| 14 | Tenant isolation across leads, calls, reports, notifications, exports and billing | Staging only | At least two test orgs and role accounts; tamper org/lead IDs at API boundary; expect consistent denial and no foreign data in responses. |
| 15 | Production owner login and paid flows | Production only with explicit release/test-account approval | Only after all prior staging gates, database reconciliation, backup/rollback readiness, and provider production approval. Do not use live payment or calling in a smoke test unless separately approved. |

## Safe production checks

After a separately approved deployment, read-only checks may verify page load, health endpoint, static asset delivery, login page rendering, and existing approved test-account session behavior. Do not create organizations/leads, send OTP emails, invoke call APIs, create checkout, modify production data, or trigger migrations as part of a generic smoke test.

## Evidence capture

For each step record timestamp, environment/project, test fixture IDs, expected/actual result, HTTP status and redacted error code. Never record OTP values, tokens, full contact data, raw webhook bodies, or credentials. Record database verification separately from API mocks. Stop on cross-tenant data, signature acceptance of invalid requests, duplicate billing activation, or unexpected real-provider activity.

## Exit criteria

All staging steps relevant to enabled features pass; required migrations and deployed definitions are reconciled; no critical/high security issue remains unknown; checkout/calling remain disabled until their own sandbox sign-offs; an approved deployment artifact and rollback plan exist. Record non-applicable features explicitly; do not mark a feature passed based on source inspection alone.
