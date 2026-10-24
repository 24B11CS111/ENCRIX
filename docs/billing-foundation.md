# ENCRIX billing foundation (draft)

This phase adds server-only plan placeholders and an unapplied, additive schema migration. It does not call Razorpay, activate subscriptions, change authentication, or enforce a paywall. The plan values are intentionally unset until commercial values are approved.

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

The API accepts only `RAZORPAY_KEY_ID` values with the Test Mode `rzp_test_` prefix and reads `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `RAZORPAY_PLAN_STARTER`, `RAZORPAY_PLAN_PROFESSIONAL`, `RAZORPAY_PLAN_BUSINESS`, plus `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT` from server environment. The key ID, keys, plan IDs, and duration are not present in local environment files. The plan catalog also intentionally has null pricing/limits and `checkoutEnabled: false`, so checkout returns a safe configuration error before contacting Razorpay.

To prepare Razorpay Test Mode after commercial approval: switch the Razorpay Dashboard to Test Mode; create three monthly INR plans with interval 1 and approved amounts; record each immutable plan ID; generate the Test Mode API key pair; configure a webhook endpoint ending in `/api/billing/webhook` with an independently chosen webhook secret and subscription/payment lifecycle events; then set the names above in local server environment and Vercel Preview/Test configuration. The selected recurring billing period count must be approved before setting `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT`. Never add these values to a `VITE_` variable. Do not create production-mode plans/keys or enable subscription enforcement in this phase.

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

## Safe rollout and grandfathering

No entitlement is inferred from the new tables in this phase. `isSubscriptionEnforcementEnabled()` reads only the server-side `SUBSCRIPTION_ENFORCEMENT_ENABLED` variable; it defaults to false and nothing in this phase invokes it to change existing access. Keep it false on the server until an approved existing-account policy, a defined cutoff, and tested backfill are ready. Existing organizations must remain on the current access behavior while this flag is off. When enforcement is later enabled, the server must treat organizations created before the approved cutoff as grandfathered; unknown/missing subscription rows must not be interpreted as a denial for those organizations. New organizations require the explicitly approved policy. The flag must never be a `VITE_` variable.

## Verification commands

```powershell
npm run build
npx vitest run src/test/billing_foundation.test.ts
git diff --check
```

The Vercel CLI build should be run only if the CLI is already installed locally; do not install it just for this foundation phase. No production database or Vercel setting should be changed.

## Decisions required before Razorpay Test Mode

- Approved INR monthly prices, seat/lead/automation limits, and feature matrix for each plan.
- Grandfathering policy and exact cutoff for existing organizations.
- Whether renewal is automatic and cancellation takes effect immediately or at period end.
- Test-mode Razorpay plan creation and webhook endpoint/secret setup.
- Refund, failed-payment grace period, retries, and past-due entitlement behavior.
- Billing-history visibility and administrator support/audit permissions.
- Production migration order and preflight, given the already identified missing earlier migrations.
