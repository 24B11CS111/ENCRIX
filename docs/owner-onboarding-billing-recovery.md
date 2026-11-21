# Owner onboarding and billing staging recovery

## Migration order

The expected dependency chain is `20261001000000_init_leadvault.sql` (organizations/profiles), `20261007000000_otp_authentication_and_onboarding.sql` (pending_registrations), `20261023000000_billing_foundation.sql` (subscription/payment tables), `20261030000000_owner_business_billing_details.sql`, then `20261031000000_onboarding_billing_integrity.sql`. Confirm the staging migration history and actual schema before applying either new migration. Apply to staging only, in timestamp order, after the preflights below return no unresolved rows. Never run these instructions against production.

## Read-only preflight SQL

```sql
-- The unique lower(email) profile index will fail for these records.
SELECT lower(email) AS normalized_email, array_agg(id) AS profile_ids
FROM public.profiles WHERE email IS NOT NULL
GROUP BY lower(email) HAVING count(*) > 1;

-- The owner_id unique index will fail for these records.
SELECT owner_id, array_agg(id) AS organization_ids
FROM public.organizations WHERE owner_id IS NOT NULL
GROUP BY owner_id HAVING count(*) > 1;

-- New integrity constraints require no rows from these checks.
SELECT id, entitlement_source FROM public.organization_subscriptions
WHERE entitlement_source = 'razorpay' AND amount_paise IS NULL;
SELECT id, organization_id, status FROM public.billing_payments WHERE subscription_id IS NULL;
SELECT id, status, paid_at, signature_verified_at, failed_at FROM public.billing_payments
WHERE (status = 'captured' AND (paid_at IS NULL OR signature_verified_at IS NULL))
   OR (status = 'failed' AND failed_at IS NULL);
```

Do not delete or automatically rewrite any returned customer or payment records. Have the data owner identify the canonical profile/organization or payment linkage, preserve a backup/audit trail, and use an approved, reviewed one-off staging repair. Rerun all preflights and investigate any remaining rows before applying constraints.

## Staging application and validation

1. Back up the staging database and confirm the Supabase project reference independently.
2. Run the preflight queries and resolve anomalies manually.
3. Apply the two new migrations in timestamp order using the normal reviewed staging migration process.
4. Confirm `registration_otp_attempts` has RLS enabled, no `anon`/`authenticated` table grants, and `service_role` only access. Confirm all four functions have `SECURITY DEFINER`, `search_path=pg_catalog, pg_temp`, execute granted to `service_role`, and execute revoked from `PUBLIC`, `anon`, and `authenticated`.
5. Run the SQL regression test under `supabase/tests/onboarding_billing_integrity.test.sql` in a disposable local/staging test transaction. Then run owner registration and Razorpay Test Mode flows with checkout still disabled until a separate approval.

## Manual reconciliation procedure

An owner may request `POST /api/billing/reconcile` with the original checkout idempotency key. The endpoint authenticates the active owner, scopes the local lookup to that owner's organization, scans provider subscription pages, and requires exactly one match on both `notes.encrix_subscription_record_id` and `notes.encrix_organization_id`. It then checks the plan amount/currency/period/interval and subscription ID, plan, notes, quantity, and total count against the local record and configured test plan. It never creates a provider subscription. A full scan is bounded to 20 pages of 100 results; reaching that bound fails closed and requires operator review.

For unresolved `PROVIDER_SUBSCRIPTION_NOT_FOUND_SUPPORT_REQUIRED`, ambiguous, mismatch, or provider timeout cases:

1. Do not issue another subscription create request and do not mark the local row `created` by hand.
2. Record the local subscription UUID, organization UUID, idempotency key, selected plan ID, creation timestamp, and current local status.
3. In the Razorpay dashboard/API for the configured **test account only**, locate the subscription(s) and preserve provider subscription ID, plan ID, status, quantity, total count, creation timestamp, short URL, and the exact two ENCRIX notes. Preserve the API response or dashboard evidence in the incident record.
4. Confirm the provider account is the same test account configured for this staging environment; verify exactly one subscription has both exact note values and the configured plan details. For a notes mismatch or multiple matches, do not attach either candidate without a second-person review and a documented owner/org mapping.
5. If one exact candidate exists, rerun the authenticated reconciliation endpoint. If pagination/API access prevents that, have an authorized operator prepare a reviewed, audited update that sets only `razorpay_subscription_id`, `razorpay_short_url`, and `checkout_creation_status='created'`, with predicates on the local UUID, organization UUID, and current reconciliation state. Never change organization ownership, payment status, amount, or entitlement as part of recovery.
6. If no exact candidate exists, retain the reconciliation record and incident evidence. Only after independently verifying the provider has no matching subscription may the billing owner approve a documented cancellation/closure and a fresh checkout attempt. Do not automatically reset the row or mint a new provider subscription.
