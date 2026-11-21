# ENCRIX billing foundation (historical implementation note)

> **Current commercial source of truth:** ENCRIX offers one subscription: ₹9,999 INR per year. There is no onboarding or registration fee. Twilio account, number, and usage charges are paid separately by the customer to Twilio. This note documents the original billing foundation and rollout decisions; its earlier multi-plan proposals below are superseded. The implementation permits Test Mode checkout only when the server-side Razorpay test plan, credentials, and database are verified. Live keys are rejected.

This note began as a billing foundation proposal. The implementation described below has since evolved: server-side Test Mode checkout, payment verification, webhook reconciliation, and unconditional paid-entitlement checks are implemented in the current source. Database migration application and provider verification remain separate release gates.

## Data model proposal

`organization_subscriptions` references the existing `organizations.id`, records one current subscription per organization, uses explicit lifecycle states, and stores provider IDs and billing-period/cancellation timestamps. Historical rows remain available by setting `is_current = false`.

`billing_payments` records the server-created idempotency key, provider order/payment/invoice IDs, amount in paise, INR currency, verified signature timestamp, and payment lifecycle timestamps. Amount and payment status must be derived and verified server-side.

`billing_webhook_events` uses a unique `(provider, provider_event_id)` key for deduplication. It stores a SHA-256 payload digest rather than raw webhook content. The webhook handler must verify the signature over the original request bytes before accepting or processing an event. Event state transitions must be idempotent and tolerate out-of-order events.

All three tables have RLS enabled, no grants to `anon` or `authenticated`, and grants/policies for `service_role`. Browser writes and direct browser reads are denied. Billing reads must go through an authenticated server route that resolves the caller's organization from the current server-verified profile; administrators' cross-tenant access must be separately explicit and audited.

The proposed migration is `supabase/migrations/20261023000000_billing_foundation.sql`. It assumes earlier organization migrations have been applied, and must run only after a production migration-history/schema preflight. It is transactional in PostgreSQL, but DDL rollback does not reverse external Razorpay actions (none occur in this migration). No production migration has been run.

## API entrypoint consolidation

There were 12 current Vercel API entrypoints: 4 auth, 1 cron, 3 leads, and 4 telephony. The leads handlers have now been moved under `api/_lib/leads/` and `api/leads.ts` dispatches only exact action names (`detail`, `distribute`, `distribution-config`). Exact rewrites preserve their public paths, methods, request data, response shapes, auth checks, role checks, and phone masking. The Vite API middleware has matching aliases. This replaces 3 entrypoints with 1.

`api/billing.ts` now handles only exact actions (`plans`, `checkout`, `verify`, `webhook`, `subscription`) selected by ordered exact rewrites. The route count is 11 (12 - 3 + 1 + 1), retaining one Hobby slot. The billing webhook is the only unauthenticated action and requires an HMAC over the raw request bytes. Vercel's local build could not be completed in this environment; route rewrites and local API aliases have unit coverage, but deployment recognition still needs a successful Vercel build.

## Test Mode integration and remaining configuration blockers

The API accepts only `RAZORPAY_KEY_ID` values with the Test Mode `rzp_test_` prefix and reads `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_BUSINESS`, and `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT` from the server environment. The only published plan is Business: ₹9,999 INR yearly (999900 paise), interval 1. Checkout is dynamically unavailable until all test credentials, plan details, and database configuration validate. Captured payment persistence and subscription activation use the atomic `apply_verified_razorpay_payment` RPC from migration `20261031170000_razorpay_atomic_subscription_lifecycle.sql`.

There is no billing grace period: a subscription is `active` only after a verified captured payment for its current billing period; `pending_payment` and `past_due` are not active billing states. At the verified period end, the owner billing endpoint marks an active row `expired` and clears `is_current`, allowing a new subscription record. Full refunds move the current subscription to `past_due` unless another captured payment covers that period; partial refunds remain recorded on the payment. Cancellation and expiry are terminal for that subscription record; a new checkout creates a new record. Paid CRM APIs enforce the database entitlement function unconditionally. `SUBSCRIPTION_ENFORCEMENT_ENABLED` is obsolete and must not be used as a bypass.

To prepare Razorpay Test Mode, use one INR yearly plan for 999900 paise with interval 1; record its immutable plan ID; generate the Test Mode API key pair; configure a webhook endpoint ending in `/api/billing/webhook` with an independently chosen webhook secret and subscription/payment lifecycle events; then set the server-only names above in staging configuration. Never add these values to a `VITE_` variable. Do not create production-mode plans/keys or change the entitlement policy.

Razorpay requires creating a plan before a subscription and defines the plan cadence using `period` and `interval`; monthly plans use the monthly cadence. Subscription checkout verification uses HMAC-SHA256 over `payment_id|subscription_id`; webhook verification uses HMAC-SHA256 over the exact raw request body. See [Razorpay Create Plan API](https://razorpay.com/docs/api/payments/subscriptions/create-plan/), [Razorpay subscription signature documentation](https://github.com/razorpay/markdown-docs/blob/master/payments/payment-gateway/s2s-integration/subscriptions.md), and [Razorpay security checklist](https://razorpay.com/security/checklist/).

## Entitlement enforcement matrix

| Access path | Existing boundary | Subscription enforcement design | Preserve existing restrictions |
|---|---|---|---|
| Auth routes (`api/auth/*`) | OTP/session validation | Keep registration, login, invitation, and session restoration available; no CRM entitlement gate | Existing OTP, session signing, and profile status checks |
| Leads APIs (`api/leads/*`) | Server session, tenant checks, role checks | Add a server-side entitlement check after identity resolution and before CRM data access | Keep owner/admin/assigned-telecaller behavior and org scoping |
| Telephony call API | Server session, lead tenant/assignment checks | Require entitlement before initiating a new call | Keep assigned lead check; never return phone digits beyond current authorized call behavior |
| Telephony voice/webhook callbacks | Provider request/signature validation | Do not block callbacks for an already-started call; callbacks do not grant entitlement | Keep provider signature validation and event idempotency |
| Recording API and Storage | Authenticated session, recording path authorization, private bucket | Require current entitlement for new playback requests, in addition to recording-specific authorization | Keep `public.can_access_call_recording_path(name)`, tenant/assignment rules, and private bucket |
| Reminder cron | `CRON_SECRET` or authorized owner/admin session | Gate reminder automation by the same organization's entitlement only after the business policy is approved | Keep secret validation, concurrency controls, and no duplicate/lost reminder semantics |
| Direct browser Supabase table queries | PostgreSQL RLS and grants | Add entitlement predicate to each paid CRM table's existing policies while preserving tenant and role predicates | Never rely on React state; keep telecaller projections phone-free |
| PostgreSQL RPCs/views | Function grants, explicit identity/role/tenant checks, view grants | Add entitlement checks inside functions that expose paid CRM data or actions | Keep definer/search-path hardening, role checks, masking, and organization checks |
| Realtime | Supabase table RLS/channel scoping | RLS entitlement predicate limits subscribed rows; stop/resubscribe channels when status changes | Keep organization scoping and existing telecaller-safe row shape |
| Billing endpoints and tables | To be implemented | Authenticated endpoints resolve organization from verified profile; service-role writes only; webhook has signature verification and idempotency | Never accept browser price, plan, organization, or payment-status claims |

The server-side API Supabase client uses a service-role key and bypasses RLS. Therefore, every user-facing API handler must perform an explicit entitlement check; RLS alone cannot protect these paths.

## Current entitlement policy

Paid CRM APIs check the authoritative `organization_has_active_paid_entitlement` database function unconditionally. There is no rollout flag or fail-open mode: missing, invalid, expired or unavailable subscription state denies the paid operation. Billing, checkout, subscription status/history and account access remain available so an owner can renew. This server-side gate does not certify that the corresponding staging migrations have been applied; validate that separately before staging use.

## Verification commands

```powershell
npm run build
npx vitest run src/test/billing_foundation.test.ts
git diff --check
```

The Vercel CLI build should be run only if the CLI is already installed locally; do not install it just for this foundation phase. No production database or Vercel setting should be changed.

## Remaining operational decisions before Razorpay Test Mode

- Staging test approval and Test Mode Business plan/webhook setup; the price and annual cadence are fixed at ₹9,999 per year.
- Confirm the provider's Test Mode webhook event delivery and lifecycle edge cases against the configured account.
- Staging migration order and preflight, given the already identified unverified or pending migrations.


## Approved refund and cancellation workflow (local candidate)

Business decision: the one-time ₹10,000 onboarding fee is deferred. Business remains ₹9,999/year. Owner billing checkout must contain only the annual subscription.

Refunds require manual review. Owners can submit a reason and amount for a captured payment. The server associates the request with the authenticated owner's organization and related subscription/payment. A global ADMIN must explicitly review and approve/reject; the database records reviewer, timestamp, amount, entitlement decision and append-only review event. Amount reservations are serialized on the payment row and bounded by the remaining captured balance. Provider payment/refund state is fetched and reconciled through the signed webhook path. Pending requests do not change payment state or access. A partial refund only preserves access when the provider total matches internal completed refund decisions and an administrator chose retain.

Cancellation is requested by an authenticated organization owner and sent server-side to Razorpay as end-of-current-cycle cancellation. The API requires the provider response to bind to the stored organization/subscription/plan, remain active, and report a scheduled change at `current_end`. Provider client errors trigger a provider-state read before marking the request failed; uncertain outcomes remain pending reconciliation. Access stays available until the period end, and a verified charge at/after the saved cancellation boundary cannot renew entitlement. Razorpay Test Mode/native PostgreSQL verification and an administrator-facing review UI/runbook are still required.
