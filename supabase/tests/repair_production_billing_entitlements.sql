-- ============================================================================
-- ENCRIX Production Billing & Paid Entitlement Schema Repair
-- Target Database: wrzoqxesffbfirjgotbr (Production)
-- Purpose: Safely provision missing billing/entitlement tables and the
--          organization_has_active_paid_entitlement RPC without modifying
--          existing data or granting fake entitlements.
-- ============================================================================

BEGIN;

-- 1. organization_subscriptions table
CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    plan_code TEXT NOT NULL CHECK (plan_code IN ('starter', 'professional', 'business')),
    status TEXT NOT NULL CHECK (
        status IN ('pending_payment', 'active', 'past_due', 'cancelled', 'expired')
    ),
    entitlement_source TEXT NOT NULL CHECK (
        entitlement_source IN ('razorpay', 'grandfathered', 'manual')
    ),
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    checkout_idempotency_key UUID NOT NULL UNIQUE,
    checkout_creation_status TEXT NOT NULL DEFAULT 'creating' CHECK (
        checkout_creation_status IN ('creating', 'created', 'reconciliation_required')
    ),
    amount_paise BIGINT CHECK (amount_paise IS NULL OR amount_paise > 0),
    razorpay_customer_id TEXT,
    razorpay_plan_id TEXT,
    razorpay_total_count INTEGER,
    razorpay_subscription_id TEXT UNIQUE,
    razorpay_short_url TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    last_payment_at TIMESTAMPTZ,
    cancellation_request_status TEXT CHECK (cancellation_request_status IN ('pending', 'scheduled', 'failed')),
    cancellation_requested_at TIMESTAMPTZ,
    cancellation_effective_at TIMESTAMPTZ,
    cancellation_provider_status TEXT,
    cancellation_request_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT organization_subscriptions_period_order
        CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end >= current_period_start),
    CONSTRAINT organization_subscriptions_id_organization_unique
        UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_subscriptions_one_current_per_org
    ON public.organization_subscriptions(organization_id)
    WHERE is_current;

CREATE INDEX IF NOT EXISTS organization_subscriptions_status_period_end
    ON public.organization_subscriptions(status, current_period_end);

-- 2. billing_payments table
CREATE TABLE IF NOT EXISTS public.billing_payments (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    subscription_id UUID,
    provider TEXT NOT NULL DEFAULT 'razorpay' CHECK (provider = 'razorpay'),
    idempotency_key TEXT NOT NULL UNIQUE,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT UNIQUE,
    razorpay_invoice_id TEXT,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    status TEXT NOT NULL CHECK (
        status IN ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')
    ),
    amount_refunded_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded_paise >= 0 AND amount_refunded_paise <= amount_paise),
    signature_verified_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_payments_subscription_organization_fkey
        FOREIGN KEY (subscription_id, organization_id)
        REFERENCES public.organization_subscriptions(id, organization_id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS billing_payments_org_created
    ON public.billing_payments(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_payments_subscription_created
    ON public.billing_payments(subscription_id, created_at DESC);

-- 3. billing_webhook_events table
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    provider TEXT NOT NULL DEFAULT 'razorpay' CHECK (provider = 'razorpay'),
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_sha256 CHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    processing_status TEXT NOT NULL DEFAULT 'received' CHECK (
        processing_status IN ('received', 'processing', 'processed', 'ignored', 'failed')
    ),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    CONSTRAINT billing_webhook_events_provider_event_unique UNIQUE (provider, provider_event_id)
);

-- 4. organization_pilot_entitlements table
CREATE TABLE IF NOT EXISTS public.organization_pilot_entitlements (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    granted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    grant_reason TEXT NOT NULL,
    revoked_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT,
    CONSTRAINT organization_pilot_entitlements_expiry_check
        CHECK (expires_at > granted_at AND expires_at <= granted_at + INTERVAL '365 days'),
    CONSTRAINT organization_pilot_entitlements_revocation_check
        CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
            OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS organization_pilot_entitlements_active_org_idx
    ON public.organization_pilot_entitlements (organization_id, expires_at DESC)
    WHERE revoked_at IS NULL;

-- 5. organization_pilot_entitlement_events table
CREATE TABLE IF NOT EXISTS public.organization_pilot_entitlement_events (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    entitlement_id UUID NOT NULL REFERENCES public.organization_pilot_entitlements(id) ON DELETE RESTRICT,
    actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('GRANTED', 'REVOKED')),
    reason TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp()
);

-- 6. billing_refund_requests table
CREATE TABLE IF NOT EXISTS public.billing_refund_requests (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    subscription_id UUID NOT NULL REFERENCES public.organization_subscriptions(id) ON DELETE RESTRICT,
    payment_id UUID NOT NULL REFERENCES public.billing_payments(id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    request_idempotency_key UUID NOT NULL UNIQUE,
    requested_amount_paise BIGINT NOT NULL CHECK (requested_amount_paise > 0),
    approved_amount_paise BIGINT CHECK (approved_amount_paise IS NULL OR (approved_amount_paise > 0 AND approved_amount_paise <= requested_amount_paise)),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 10 AND length(reason) <= 1000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'partially_refunded', 'refunded', 'failed')),
    entitlement_action TEXT CHECK (entitlement_action IS NULL OR entitlement_action IN ('retain', 'revoke')),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    decision_note TEXT CHECK (decision_note IS NULL OR length(btrim(decision_note)) >= 6),
    provider_refund_id TEXT UNIQUE,
    provider_refund_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 7. RLS Configuration on billing tables
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_pilot_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_pilot_entitlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_refund_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organization_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_webhook_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_pilot_entitlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_pilot_entitlement_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_refund_requests FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.organization_subscriptions TO service_role;
GRANT ALL ON TABLE public.billing_payments TO service_role;
GRANT ALL ON TABLE public.billing_webhook_events TO service_role;
GRANT ALL ON TABLE public.organization_pilot_entitlements TO service_role;
GRANT ALL ON TABLE public.organization_pilot_entitlement_events TO service_role;
GRANT ALL ON TABLE public.billing_refund_requests TO service_role;

-- 8. Authoritative Paid Entitlement RPC
CREATE OR REPLACE FUNCTION public.organization_has_active_paid_entitlement(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.organization_subscriptions AS s
    JOIN public.billing_payments AS p ON p.subscription_id=s.id AND p.organization_id=s.organization_id
    WHERE s.organization_id=p_organization_id AND s.plan_code='business' AND s.amount_paise=999900
      AND s.entitlement_source='razorpay' AND s.status='active' AND s.is_current IS TRUE
      AND s.checkout_creation_status='created' AND s.razorpay_subscription_id ~ '^sub_[A-Za-z0-9]+$'
      AND s.current_period_start IS NOT NULL AND s.current_period_end IS NOT NULL
      AND s.current_period_start<=pg_catalog.statement_timestamp() AND s.current_period_end>pg_catalog.statement_timestamp()
      AND p.provider='razorpay' AND p.razorpay_payment_id ~ '^pay_[A-Za-z0-9]+$' AND p.status='captured'
      AND p.currency='INR' AND p.amount_paise=s.amount_paise AND p.amount_refunded_paise<p.amount_paise
      AND p.signature_verified_at IS NOT NULL AND p.paid_at IS NOT NULL
      AND p.paid_at>=s.current_period_start AND p.paid_at<s.current_period_end
      AND (p.amount_refunded_paise=0 OR (
        SELECT COALESCE(sum(r.approved_amount_paise),0)=p.amount_refunded_paise
          AND bool_and(r.status='partially_refunded' AND r.entitlement_action='retain')
        FROM public.billing_refund_requests AS r WHERE r.payment_id=p.id AND r.organization_id=p.organization_id
          AND r.status IN ('partially_refunded','refunded')
      ))
  ) OR EXISTS (
    SELECT 1 FROM public.organization_pilot_entitlements AS e
    WHERE e.organization_id=p_organization_id
      AND e.revoked_at IS NULL
      AND e.expires_at>pg_catalog.statement_timestamp()
  ),FALSE);
$function$;

REVOKE ALL ON FUNCTION public.organization_has_active_paid_entitlement(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organization_has_active_paid_entitlement(UUID) TO service_role;

-- 9. Founding Pilot Administration RPCs
CREATE OR REPLACE FUNCTION public.grant_founding_pilot_entitlement(
  p_organization_id UUID,
  p_granted_by UUID,
  p_expires_at TIMESTAMPTZ,
  p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_entitlement_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.statement_timestamp();
  v_reason TEXT := pg_catalog.btrim(p_reason);
BEGIN
  IF p_organization_id IS NULL OR p_granted_by IS NULL OR p_expires_at IS NULL
     OR v_reason IS NULL OR pg_catalog.char_length(v_reason) < 6
     OR pg_catalog.char_length(v_reason) > 500
     OR p_expires_at <= v_now OR p_expires_at > v_now + INTERVAL '365 days' THEN
    RAISE EXCEPTION 'invalid_pilot_parameters' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_granted_by AND role = 'ADMIN' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'admin_authorization_required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_pilot_entitlements
    WHERE organization_id = p_organization_id AND revoked_at IS NULL AND expires_at > v_now
  ) THEN
    RAISE EXCEPTION 'active_pilot_entitlement_exists' USING ERRCODE = '23505';
  END IF;

  IF (
    SELECT COUNT(DISTINCT organization_id)
    FROM public.organization_pilot_entitlements
    WHERE revoked_at IS NULL AND expires_at > v_now
  ) >= 3 THEN
    RAISE EXCEPTION 'founding_pilot_capacity_exceeded' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.organization_pilot_entitlements (
    organization_id, granted_by, granted_at, expires_at, grant_reason
  ) VALUES (
    p_organization_id, p_granted_by, v_now, p_expires_at, v_reason
  ) RETURNING id INTO v_entitlement_id;

  INSERT INTO public.organization_pilot_entitlement_events (
    organization_id, entitlement_id, actor_profile_id, action, reason, expires_at, occurred_at
  ) VALUES (
    p_organization_id, v_entitlement_id, p_granted_by, 'GRANTED', v_reason, p_expires_at, v_now
  );

  RETURN v_entitlement_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.grant_founding_pilot_entitlement(UUID, UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_founding_pilot_entitlement(UUID, UUID, TIMESTAMPTZ, TEXT) TO service_role;

COMMIT;
