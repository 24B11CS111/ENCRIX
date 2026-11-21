-- Central, read-only entitlement authority for paid organization features.
-- It grants no feature access to trials/manual rows or to client-supplied state.
BEGIN;

CREATE FUNCTION public.organization_has_active_paid_entitlement(p_organization_id UUID)
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
      AND s.razorpay_subscription_id IS NOT NULL
      AND s.current_period_start IS NOT NULL
      AND s.current_period_end IS NOT NULL
      AND s.current_period_start <= pg_catalog.statement_timestamp()
      AND s.current_period_end > pg_catalog.statement_timestamp()
      AND p.provider = 'razorpay'
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
