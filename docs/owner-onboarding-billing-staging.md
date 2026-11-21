# Owner onboarding and billing staging verification

Owner registration continues to use ENCRIX email OTP and its HMAC-signed ticket. The signed token alone is not sufficient: the send endpoint must first issue a durable, email-bound ticket and pending registration through the service-only `issue_registration_otp_ticket` RPC. Verification checks the HMAC in constant time, records the result and failures under a row lock, and registration atomically consumes a verified, unexpired ticket with organization/profile creation. No process-local or client-supplied registration fallback is accepted. This does not create a password or change the authentication provider. New organization business contact fields are added by `20261030000000_owner_business_billing_details.sql`.

## Database staging

1. Confirm the intended Supabase staging project and inspect its applied migration history.
2. Check for duplicate profile emails ignoring case and multiple organizations sharing one `owner_id`. Resolve staging data anomalies before creating the unique indexes:

   ```sql
   SELECT LOWER(email), COUNT(*) FROM public.profiles
   WHERE email IS NOT NULL GROUP BY LOWER(email) HAVING COUNT(*) > 1;

   SELECT owner_id, COUNT(*) FROM public.organizations
   GROUP BY owner_id HAVING COUNT(*) > 1;
   ```
3. Back up the staging schema, then apply the migration above to staging only.
4. Confirm the new fields and two unique indexes exist. Confirm `registration_otp_attempts` has RLS enabled and no table privileges for `PUBLIC`, `anon`, `authenticated`, or `service_role`; only the intended service-only RPCs should be executable by `service_role`.
5. Confirm `issue_registration_otp_ticket`, `complete_registration_otp_verification`, `get_registration_otp_attempts`, `cancel_registration_otp_ticket`, and `create_owner_registration` are `SECURITY DEFINER` with `search_path=pg_catalog, pg_temp`, and that no legacy `create_owner_registration` overload or `record_registration_otp_failure` function remains.
6. Register an owner with a fresh email, verify the OTP, and confirm the organization stores the business email, phone, location, and optional URL. Verify missing, mismatched, expired, failed, and already-consumed tickets fail closed.
7. Confirm a replay or concurrent duplicate email registration cannot create a second organization, and that direct browser access to billing tables remains denied.
8. Do not apply this migration to production automatically.

## Razorpay test mode

Set these only in the staging server environment, never in `VITE_*` frontend variables:

- `RAZORPAY_KEY_ID` — Razorpay test key ID beginning `rzp_test_`.
- `RAZORPAY_KEY_SECRET` — test key secret.
- `RAZORPAY_WEBHOOK_SECRET` — secret configured for the staging webhook endpoint.
- `RAZORPAY_PLAN_BUSINESS` — test plan ID whose provider record must be INR 999900 paise, yearly, interval 1.
- `RAZORPAY_SUBSCRIPTION_TOTAL_COUNT` — positive number of annual billing periods to create.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — staging server credentials.

Starter and Professional remain drafts. Business is the only available catalog plan, but checkout is dynamically reported unavailable unless the server has an `rzp_test_` key ID, a valid test key secret, the exact ₹9,999/year INR plan, a positive annual cycle count, and a configured billing database. There is no separate checkout flag to change. Never use a live Razorpay key in this integration.

## Checkout and webhook staging checks

1. With Razorpay test configuration absent, confirm `GET /api/billing/plans` reports `checkoutAvailable: false` and `POST /api/billing/checkout` fails closed. With verified Test Mode configuration, confirm checkout returns the server-created subscription without accepting a browser-supplied amount or organization.
2. In Razorpay Test Mode, call `GET https://api.razorpay.com/v1/plans/{RAZORPAY_PLAN_BUSINESS}` with test Basic Auth. Verify the returned plan `id`, `item.amount` (999900), `item.currency` (`INR`), `period` (`yearly`), and `interval` (1) against the server configuration before considering checkout enablement.
3. Verify owner authorization, idempotent checkout retry, duplicate current-subscription rejection, and recovery of any `reconciliation_required` record.
4. Complete a test subscription. Confirm a valid signature alone does not activate it unless Razorpay payment and subscription records match the local organization notes, amount, currency, plan, cycle count, and subscription. Payment persistence and activation must commit together through the lifecycle RPC.
5. Deliver the same signed webhook twice; confirm the second delivery is a harmless duplicate. Retry a failed webhook after its processing claim becomes stale.
6. Exercise authorized, failed, captured, partial refund, full refund, pending, halted, cancelled, expired, and invalid/mismatched events. Only a verified captured payment covering the current billing period can produce `active`. No grace period is configured. Full refund moves the subscription to `past_due` unless another captured payment covers the period; a late failed event must not downgrade a capture.
7. Close the browser during checkout and confirm the owner can return to Pricing & Billing and see status and payment history populated by server-verified webhooks. Replay a webhook from Razorpay Test Mode to confirm delivery retries are safe; never infer success from browser state.
8. Confirm no live payment is possible and no subscription is activated by a client callback.
