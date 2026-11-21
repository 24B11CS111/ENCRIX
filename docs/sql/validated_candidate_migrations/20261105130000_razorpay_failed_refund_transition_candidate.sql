-- Permit a failed payment to become refunded only when the verified provider
-- state proves that a capture and full refund occurred out of order.
-- Apply after 20261031170000_razorpay_atomic_subscription_lifecycle_candidate.sql.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.billing_payments') IS NULL THEN
    RAISE EXCEPTION 'Billing payment table is missing; inspect before retrying.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.billing_payments'::regclass
      AND attname IN (
        'organization_id', 'subscription_id', 'razorpay_payment_id',
        'status', 'amount_paise', 'amount_refunded_paise',
        'signature_verified_at', 'paid_at'
      )
    GROUP BY attrelid
    HAVING count(*) = 8
  ) THEN
    RAISE EXCEPTION 'Billing payment transition columns are missing or differ; inspect before retrying.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.billing_payments'::regclass
      AND tgname = 'protect_billing_payment_identity'
      AND NOT tgisinternal
      AND tgfoid = to_regprocedure('public.protect_billing_payment_identity()')
  ) THEN
    RAISE EXCEPTION 'Billing payment identity trigger is missing or differs; inspect before retrying.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.protect_billing_payment_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
     OR OLD.subscription_id IS DISTINCT FROM NEW.subscription_id THEN
    RAISE EXCEPTION 'billing_payment_identity_conflict' USING ERRCODE = '23514';
  END IF;
  IF OLD.razorpay_payment_id IS NOT NULL
     AND OLD.razorpay_payment_id IS DISTINCT FROM NEW.razorpay_payment_id THEN
    RAISE EXCEPTION 'billing_payment_identity_conflict' USING ERRCODE = '23514';
  END IF;
  IF NEW.razorpay_payment_id IS NOT NULL AND btrim(NEW.razorpay_payment_id) = '' THEN
    RAISE EXCEPTION 'billing_payment_identity_conflict' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'created' AND NEW.status IN ('authorized','captured','failed'))
    OR (OLD.status = 'authorized' AND NEW.status IN ('captured','failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'captured')
    OR (OLD.status = 'failed' AND NEW.status = 'refunded'
        AND NEW.amount_refunded_paise = NEW.amount_paise
        AND NEW.signature_verified_at IS NOT NULL
        AND NEW.paid_at IS NOT NULL)
    OR (OLD.status = 'captured' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'billing_payment_status_transition_invalid' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('captured','refunded') THEN
    NEW.signature_verified_at := COALESCE(NEW.signature_verified_at, OLD.signature_verified_at);
    NEW.paid_at := COALESCE(NEW.paid_at, OLD.paid_at);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.protect_billing_payment_identity()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
