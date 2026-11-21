# ENCRIX Billing Test Report

**Assessment date:** 2026-11-08  
**Result:** Local contract and SQL tests pass; Razorpay Test Mode lifecycle is not verified.

## Approved commercial decisions

- Business: **₹9,999 INR annually**.
- ₹10,000 onboarding fee: **deferred to a later release**.
- Refunds: **manual admin review**.
- Cancellation: **at the end of the paid period**; paid access remains through subscription expiry.

The current server-side catalog in `api/_lib/billingPlans.ts` sets the Business price and annual interval, and leaves `checkoutEnabled: false`. Do not enable real checkout.

## Local test evidence

- Full Vitest run: **90 files / 1,008 tests passed**, including billing API, policy, entitlement, webhook/lifecycle contract, and refund workflow coverage.
- SQL regression run: **16/16 passed**, including `razorpay_atomic_subscription_lifecycle`, `paid_subscription_entitlement_gate`, and `onboarding_billing_integrity`.
- TypeScript checks passed. No provider request was made.

## Not verified

- Razorpay Test Mode account/key/plan separation or provider-side ₹9,999 yearly plan details.
- Test checkout, signed webhook delivery, subscription activation/renewal, failed payments, replay/out-of-order events, cancellation timing, or refund processing.
- Provider-to-database reconciliation, actual entitlement expiration, and staging access after expiry.
- Real Razorpay credentials or any local secret values were not read or tested.

**Gate:** Keep checkout disabled until a separately isolated staging run validates signed Test Mode webhooks and the full subscription/refund/cancellation lifecycle. No real payment was initiated.
