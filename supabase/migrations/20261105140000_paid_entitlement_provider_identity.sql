-- Require provider-shaped Razorpay IDs in addition to the existing paid,
-- captured, signature-verified entitlement predicates.
-- Apply after 20261031180000_paid_subscription_entitlement_gate.sql.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.organization_subscriptions') IS NULL
     OR to_regclass('public.billing_payments') IS NULL THEN
    RAISE EXCEPTION 'Billing tables are missing; inspect before retrying.';
  END IF;
  IF to_regprocedure('public.organization_has_active_paid_entitlement(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Paid entitlement RPC is missing; apply and verify its prerequisite migration first.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.organization_has_active_paid_entitlement(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.organization_subscriptions AS s
    JOIN public.billing_payments AS p
      ON p.subscription_id = s.id
     AND p.organization_id = s.organization_id
    WHERE s.organization_id = p_organization_id
      AND s.plan_code = 'business'
      AND s.amount_paise = 999900
      AND s.entitlement_source = 'razorpay'
      AND s.status = 'active'
      AND s.is_current IS TRUE
      AND s.checkout_creation_status = 'created'
      AND s.razorpay_subscription_id ~ '^sub_[A-Za-z0-9]+$'
      AND s.current_period_start IS NOT NULL
      AND s.current_period_end IS NOT NULL
      AND s.current_period_start <= pg_catalog.statement_timestamp()
      AND s.current_period_end > pg_catalog.statement_timestamp()
      AND p.provider = 'razorpay'
      AND p.razorpay_payment_id ~ '^pay_[A-Za-z0-9]+$'
      AND p.status = 'captured'
      AND p.currency = 'INR'
      AND p.amount_paise = s.amount_paise
      AND p.amount_refunded_paise < p.amount_paise
      AND p.signature_verified_at IS NOT NULL
      AND p.paid_at IS NOT NULL
      AND p.paid_at >= s.current_period_start
      AND p.paid_at < s.current_period_end
  ), FALSE);
$function$;

REVOKE ALL ON FUNCTION public.organization_has_active_paid_entitlement(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organization_has_active_paid_entitlement(UUID)
  TO service_role;

COMMIT;
