-- Atomic payment identity, payment history, and subscription state transitions.
-- Apply after 20261023000000_billing_foundation.sql and
-- 20261031000000_onboarding_billing_integrity.sql.
BEGIN;

ALTER TABLE public.billing_payments
  ADD COLUMN IF NOT EXISTS amount_refunded_paise BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_total_count INTEGER;

DO $preflight$
DECLARE
  v_definition TEXT;
  v_valid BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.organization_subscriptions'::regclass
      AND attname = 'razorpay_total_count'
      AND atttypid = 'pg_catalog.int4'::regtype
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'organization_subscriptions.razorpay_total_count must be an integer; inspect the existing column manually.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.billing_payments'::regclass
      AND attname = 'amount_refunded_paise'
      AND atttypid = 'pg_catalog.int8'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'billing_payments.amount_refunded_paise must be a NOT NULL bigint; inspect the existing column manually.';
  END IF;

  SELECT pg_get_constraintdef(oid), convalidated INTO v_definition, v_valid
  FROM pg_constraint
  WHERE conrelid = 'public.billing_payments'::regclass
    AND conname = 'billing_payments_refund_amount_valid';

  IF v_definition IS NULL THEN
    ALTER TABLE public.billing_payments
      ADD CONSTRAINT billing_payments_refund_amount_valid
      CHECK (amount_refunded_paise >= 0 AND amount_refunded_paise <= amount_paise);
  ELSIF lower(regexp_replace(v_definition, '\s+', '', 'g')) NOT LIKE '%amount_refunded_paise>=0%'
     OR lower(regexp_replace(v_definition, '\s+', '', 'g')) NOT LIKE '%amount_refunded_paise<=amount_paise%'
     OR NOT v_valid THEN
    RAISE EXCEPTION 'Existing billing_payments_refund_amount_valid differs or is not validated; inspect manually.';
  END IF;

  SELECT pg_get_constraintdef(oid), convalidated INTO v_definition, v_valid
  FROM pg_constraint
  WHERE conrelid = 'public.organization_subscriptions'::regclass
    AND conname = 'organization_subscriptions_total_count_positive';
  IF v_definition IS NULL THEN
    ALTER TABLE public.organization_subscriptions
      ADD CONSTRAINT organization_subscriptions_total_count_positive
      CHECK (razorpay_total_count IS NULL OR razorpay_total_count > 0);
  ELSIF lower(regexp_replace(v_definition, '\s+', '', 'g')) NOT LIKE '%razorpay_total_countisnull%'
     OR lower(regexp_replace(v_definition, '\s+', '', 'g')) NOT LIKE '%razorpay_total_count>0%'
     OR NOT v_valid THEN
    RAISE EXCEPTION 'Existing organization_subscriptions_total_count_positive differs or is not validated; inspect manually.';
  END IF;

  SELECT pg_get_constraintdef(oid), convalidated INTO v_definition, v_valid
  FROM pg_constraint
  WHERE conrelid = 'public.billing_payments'::regclass
    AND conname = 'billing_payments_refund_status_valid';
  IF v_definition IS NULL THEN
    ALTER TABLE public.billing_payments
      ADD CONSTRAINT billing_payments_refund_status_valid
      CHECK (amount_refunded_paise = 0 OR status IN ('captured', 'refunded'));
  ELSIF lower(regexp_replace(v_definition, '\s+', '', 'g')) NOT LIKE '%amount_refunded_paise=0%'
     OR lower(regexp_replace(v_definition, '\s+', '', 'g')) NOT LIKE '%status=any(array[''captured''::text,''refunded''::text])%'
     OR NOT v_valid THEN
    RAISE EXCEPTION 'Existing billing_payments_refund_status_valid differs or is not validated; inspect manually.';
  END IF;
END;
$preflight$;

CREATE INDEX billing_payments_verified_subscription_period
  ON public.billing_payments (subscription_id, paid_at)
  WHERE status = 'captured' AND signature_verified_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_verified_razorpay_payment(
  p_organization_id UUID,
  p_local_subscription_id UUID,
  p_provider_subscription_id TEXT,
  p_payment_id TEXT,
  p_invoice_id TEXT,
  p_amount_paise BIGINT,
  p_currency TEXT,
  p_payment_status TEXT,
  p_payment_created_at TIMESTAMPTZ,
  p_amount_refunded_paise BIGINT,
  p_provider_total_count INTEGER,
  p_provider_subscription_status TEXT,
  p_current_period_start TIMESTAMPTZ,
  p_current_period_end TIMESTAMPTZ,
  p_provider_verified_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_subscription public.organization_subscriptions%ROWTYPE;
  v_payment_status TEXT;
  v_payment_row_id UUID;
  v_amount_refunded BIGINT;
  v_paid_at TIMESTAMPTZ;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_has_current_period_capture BOOLEAN;
  v_next_status TEXT;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_organization_id IS NULL OR p_local_subscription_id IS NULL
     OR p_provider_subscription_id IS NULL OR p_provider_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]+$'
     OR p_amount_paise IS NULL OR p_amount_paise <= 0
     OR p_currency IS DISTINCT FROM 'INR'
     OR p_payment_status IS NULL OR p_payment_status NOT IN ('authorized', 'captured', 'failed', 'refunded')
     OR p_amount_refunded_paise IS NULL OR p_amount_refunded_paise < 0
     OR p_amount_refunded_paise > p_amount_paise
     OR (p_amount_refunded_paise > 0 AND p_payment_status NOT IN ('captured', 'refunded'))
     OR p_provider_total_count IS NULL OR p_provider_total_count < 1
     OR p_provider_subscription_status IS NULL
     OR p_provider_subscription_status NOT IN ('created', 'authenticated', 'active', 'pending', 'halted', 'paused', 'cancelled', 'completed', 'expired')
     OR p_provider_verified_at IS NULL THEN
    RAISE EXCEPTION 'razorpay_payment_validation_failed' USING ERRCODE = '22023';
  END IF;

  IF p_payment_status = 'refunded' AND p_amount_refunded_paise <> p_amount_paise THEN
    RAISE EXCEPTION 'razorpay_refund_amount_incomplete' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_subscription
  FROM public.organization_subscriptions
  WHERE id = p_local_subscription_id
    AND organization_id = p_organization_id
    AND razorpay_subscription_id = p_provider_subscription_id
    AND entitlement_source = 'razorpay'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'razorpay_subscription_identity_mismatch' USING ERRCODE = '23514';
  END IF;
  IF v_subscription.amount_paise IS DISTINCT FROM p_amount_paise
     OR v_subscription.plan_code <> 'business'
     OR v_subscription.razorpay_plan_id IS NULL
     OR (v_subscription.razorpay_total_count IS NOT NULL AND v_subscription.razorpay_total_count <> p_provider_total_count) THEN
    RAISE EXCEPTION 'razorpay_subscription_amount_or_plan_mismatch' USING ERRCODE = '23514';
  END IF;

  v_period_start := COALESCE(p_current_period_start, v_subscription.current_period_start);
  v_period_end := COALESCE(p_current_period_end, v_subscription.current_period_end);
  IF v_period_start IS NOT NULL AND v_period_end IS NOT NULL AND v_period_end < v_period_start THEN
    RAISE EXCEPTION 'razorpay_subscription_period_invalid' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.billing_payments AS existing_payment (
    organization_id, subscription_id, provider, idempotency_key, razorpay_payment_id,
    razorpay_invoice_id, amount_paise, amount_refunded_paise, currency, status,
    signature_verified_at, paid_at, failed_at
  ) VALUES (
    p_organization_id, p_local_subscription_id, 'razorpay', 'razorpay-payment:' || p_payment_id,
    p_payment_id, p_invoice_id, p_amount_paise, p_amount_refunded_paise, p_currency,
    p_payment_status,
    CASE WHEN p_payment_status IN ('captured', 'refunded') THEN p_provider_verified_at ELSE NULL END,
    CASE WHEN p_payment_status IN ('captured', 'refunded') THEN COALESCE(p_payment_created_at, p_provider_verified_at) ELSE NULL END,
    CASE WHEN p_payment_status = 'failed' THEN COALESCE(p_payment_created_at, p_provider_verified_at) ELSE NULL END
  )
  ON CONFLICT (razorpay_payment_id) DO UPDATE SET
    amount_refunded_paise = GREATEST(existing_payment.amount_refunded_paise, EXCLUDED.amount_refunded_paise),
    razorpay_invoice_id = COALESCE(EXCLUDED.razorpay_invoice_id, existing_payment.razorpay_invoice_id),
    status = CASE
      WHEN existing_payment.status = 'refunded' THEN 'refunded'
      WHEN existing_payment.status IN ('created', 'authorized') AND EXCLUDED.status = 'refunded' THEN 'captured'
      WHEN EXCLUDED.status = 'refunded' THEN 'refunded'
      WHEN existing_payment.status = 'captured' AND EXCLUDED.status IN ('authorized', 'failed') THEN 'captured'
      WHEN existing_payment.status = 'failed' AND EXCLUDED.status = 'authorized' THEN 'failed'
      ELSE EXCLUDED.status
    END,
    signature_verified_at = COALESCE(EXCLUDED.signature_verified_at, existing_payment.signature_verified_at),
    paid_at = COALESCE(EXCLUDED.paid_at, existing_payment.paid_at),
    failed_at = CASE
      WHEN existing_payment.status = 'failed' AND EXCLUDED.status = 'authorized' THEN existing_payment.failed_at
      WHEN EXCLUDED.status = 'failed' AND existing_payment.status NOT IN ('captured', 'refunded') THEN COALESCE(EXCLUDED.failed_at, existing_payment.failed_at)
      ELSE existing_payment.failed_at
    END,
    updated_at = v_now
  WHERE existing_payment.organization_id = EXCLUDED.organization_id
    AND existing_payment.subscription_id = EXCLUDED.subscription_id
    AND existing_payment.amount_paise = EXCLUDED.amount_paise
    AND existing_payment.currency = EXCLUDED.currency
  RETURNING id, status, amount_refunded_paise, paid_at
  INTO v_payment_row_id, v_payment_status, v_amount_refunded, v_paid_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'razorpay_payment_identity_or_amount_conflict' USING ERRCODE = '23514';
  END IF;

  -- The provider's current state can arrive before an intermediate captured
  -- webhook. Preserve the existing transition guard by advancing through the
  -- allowed captured state within this same transaction.
  IF p_payment_status = 'refunded' AND v_payment_status = 'captured' THEN
    UPDATE public.billing_payments
    SET status = 'refunded', amount_refunded_paise = GREATEST(amount_refunded_paise, p_amount_refunded_paise), updated_at = v_now
    WHERE id = v_payment_row_id
    RETURNING status, amount_refunded_paise, paid_at
    INTO v_payment_status, v_amount_refunded, v_paid_at;
  END IF;

  v_has_current_period_capture := FALSE;
  IF v_period_start IS NOT NULL AND v_period_end IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.billing_payments p
      WHERE p.organization_id = p_organization_id
        AND p.subscription_id = p_local_subscription_id
        AND p.status = 'captured'
        AND p.signature_verified_at IS NOT NULL
        AND p.paid_at >= v_period_start
        AND p.paid_at < v_period_end
    ) INTO v_has_current_period_capture;
  END IF;

  IF v_subscription.status IN ('cancelled', 'expired') THEN
    v_next_status := v_subscription.status;
  ELSIF p_provider_subscription_status = 'cancelled' THEN
    v_next_status := 'cancelled';
  ELSIF p_provider_subscription_status IN ('completed', 'expired') THEN
    v_next_status := 'expired';
  ELSIF v_period_end IS NOT NULL AND v_period_end <= v_now THEN
    v_next_status := 'expired';
  ELSIF p_provider_subscription_status IN ('halted', 'paused') THEN
    v_next_status := 'past_due';
  ELSIF p_provider_subscription_status = 'active' AND v_has_current_period_capture THEN
    v_next_status := 'active';
  ELSIF v_payment_status = 'refunded' AND v_amount_refunded >= p_amount_paise THEN
    v_next_status := 'past_due';
  ELSE
    v_next_status := 'pending_payment';
  END IF;

  UPDATE public.organization_subscriptions
  SET status = v_next_status,
      is_current = CASE WHEN v_next_status IN ('cancelled', 'expired') THEN FALSE ELSE is_current END,
      razorpay_total_count = COALESCE(razorpay_total_count, p_provider_total_count),
      current_period_start = COALESCE(p_current_period_start, current_period_start),
      current_period_end = COALESCE(p_current_period_end, current_period_end),
      last_payment_at = CASE WHEN v_payment_status IN ('captured', 'refunded') THEN GREATEST(COALESCE(last_payment_at, v_paid_at), v_paid_at) ELSE last_payment_at END,
      cancelled_at = CASE WHEN v_next_status = 'cancelled' THEN COALESCE(cancelled_at, v_now) ELSE cancelled_at END,
      ended_at = CASE WHEN v_next_status IN ('cancelled', 'expired') THEN COALESCE(ended_at, v_paid_at, v_now) ELSE ended_at END,
      updated_at = v_now
  WHERE id = v_subscription.id AND organization_id = p_organization_id;

  RETURN pg_catalog.jsonb_build_object('status', v_next_status, 'paymentStatus', v_payment_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_verified_razorpay_payment(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, INTEGER,
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_razorpay_payment(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ, BIGINT, INTEGER,
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

COMMIT;
