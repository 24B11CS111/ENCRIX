-- Forward-only refund review and period-end cancellation workflow foundation.
-- Requires billing foundation (20261023000000), lifecycle (20261031170000),
-- paid entitlement gate (20261031180000), and provider identity correction
-- (20261105140000). No payment rows are rewritten by this migration.
-- Recovery: this DDL/function replacement is transactional; on any error,
-- roll back the transaction and inspect the failing prerequisite. After COMMIT,
-- do not drop refund/audit records or roll back provider actions; use a reviewed
-- forward correction and reconcile provider state before retrying requests.
BEGIN;

DO $prerequisites$
BEGIN
  IF pg_catalog.to_regclass('public.organizations') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.organization_subscriptions') IS NULL
     OR pg_catalog.to_regclass('public.billing_payments') IS NULL THEN
    RAISE EXCEPTION 'Billing/onboarding prerequisites are missing; inspect the migration state before applying.';
  END IF;
END;
$prerequisites$;

ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS cancellation_request_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS cancellation_request_id UUID,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_provider_status TEXT;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.organization_subscriptions'::regclass AND conname = 'organization_subscriptions_cancellation_request_status_valid') THEN
    ALTER TABLE public.organization_subscriptions ADD CONSTRAINT organization_subscriptions_cancellation_request_status_valid
      CHECK (cancellation_request_status IN ('not_requested','pending','scheduled','failed','completed'));
  END IF;
END;
$constraints$;

CREATE TABLE public.billing_refund_requests (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  subscription_id UUID NOT NULL,
  payment_id UUID NOT NULL REFERENCES public.billing_payments(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  request_idempotency_key UUID NOT NULL,
  requested_amount_paise BIGINT NOT NULL CHECK (requested_amount_paise > 0),
  approved_amount_paise BIGINT CHECK (approved_amount_paise IS NULL OR (approved_amount_paise > 0 AND approved_amount_paise <= requested_amount_paise)),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','under_review','approved','processing','partially_refunded','refunded','rejected','failed')),
  entitlement_action TEXT CHECK (entitlement_action IS NULL OR entitlement_action IN ('retain','revoke')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  decision_note TEXT,
  provider_refund_id TEXT UNIQUE,
  provider_refund_status TEXT,
  provider_refund_created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT billing_refund_requests_payment_subscription_org_fkey
    FOREIGN KEY (subscription_id, organization_id)
    REFERENCES public.organization_subscriptions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT billing_refund_requests_idempotency_unique UNIQUE (organization_id, request_idempotency_key),
  CONSTRAINT billing_refund_requests_approved_state_consistency CHECK (
    status NOT IN ('approved','processing','partially_refunded','refunded','failed')
    OR (approved_amount_paise IS NOT NULL AND entitlement_action IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX billing_refund_requests_payment_status_idx
  ON public.billing_refund_requests(payment_id, status);
CREATE INDEX billing_refund_requests_org_created_idx
  ON public.billing_refund_requests(organization_id, created_at DESC);
CREATE UNIQUE INDEX billing_refund_requests_one_open_per_payment_idx
  ON public.billing_refund_requests(payment_id)
  WHERE status IN ('requested','under_review','approved','processing');

CREATE TABLE public.billing_refund_review_events (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  refund_request_id UUID NOT NULL REFERENCES public.billing_refund_requests(id) ON DELETE RESTRICT,
  reviewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('under_review','approved','rejected')),
  approved_amount_paise BIGINT,
  entitlement_action TEXT CHECK (entitlement_action IS NULL OR entitlement_action IN ('retain','revoke')),
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX billing_refund_review_events_request_idx
  ON public.billing_refund_review_events(refund_request_id, created_at);

ALTER TABLE public.billing_refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_refund_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.billing_refund_requests, public.billing_refund_review_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_refund_requests TO service_role;
GRANT SELECT, INSERT ON TABLE public.billing_refund_review_events TO service_role;
CREATE POLICY billing_refund_requests_service_role ON public.billing_refund_requests FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY billing_refund_review_events_service_role ON public.billing_refund_review_events FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.request_billing_refund(
  p_organization_id UUID, p_payment_id UUID, p_requester_id UUID,
  p_requested_amount_paise BIGINT, p_reason TEXT, p_request_idempotency_key UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_payment public.billing_payments%ROWTYPE; v_subscription public.organization_subscriptions%ROWTYPE;
  v_existing public.billing_refund_requests%ROWTYPE; v_reserved BIGINT;
BEGIN
  IF p_organization_id IS NULL OR p_payment_id IS NULL OR p_requester_id IS NULL OR p_request_idempotency_key IS NULL
     OR p_requested_amount_paise IS NULL OR p_requested_amount_paise <= 0 OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'refund_request_invalid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_requester_id AND organization_id=p_organization_id AND role='OWNER' AND status='ACTIVE') THEN
    RAISE EXCEPTION 'refund_owner_not_authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_payment FROM public.billing_payments WHERE id=p_payment_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'captured' OR v_payment.signature_verified_at IS NULL OR v_payment.paid_at IS NULL THEN
    RAISE EXCEPTION 'refund_payment_not_refundable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_subscription FROM public.organization_subscriptions WHERE id=v_payment.subscription_id AND organization_id=p_organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_subscription_mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_existing FROM public.billing_refund_requests
    WHERE organization_id=p_organization_id AND request_idempotency_key=p_request_idempotency_key;
  IF FOUND THEN
    IF v_existing.payment_id <> p_payment_id OR v_existing.requested_amount_paise <> p_requested_amount_paise OR v_existing.requested_by <> p_requester_id THEN
      RAISE EXCEPTION 'refund_idempotency_conflict' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object('id',v_existing.id,'status',v_existing.status,'duplicate',TRUE);
  END IF;
  SELECT COALESCE(sum(CASE WHEN status IN ('approved','processing') THEN approved_amount_paise ELSE requested_amount_paise END),0) INTO v_reserved
  FROM public.billing_refund_requests WHERE payment_id=p_payment_id AND status IN ('requested','under_review','approved','processing');
  IF p_requested_amount_paise > v_payment.amount_paise-v_payment.amount_refunded_paise-v_reserved THEN
    RAISE EXCEPTION 'refund_amount_exceeds_remaining_balance' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.billing_refund_requests(organization_id,subscription_id,payment_id,requested_by,request_idempotency_key,requested_amount_paise,reason)
  VALUES(p_organization_id,v_subscription.id,p_payment_id,p_requester_id,p_request_idempotency_key,p_requested_amount_paise,btrim(p_reason))
  RETURNING * INTO v_existing;
  RETURN pg_catalog.jsonb_build_object('id',v_existing.id,'status',v_existing.status,'duplicate',FALSE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_billing_refund_request(
  p_refund_request_id UUID, p_reviewer_id UUID, p_decision TEXT,
  p_approved_amount_paise BIGINT, p_entitlement_action TEXT, p_decision_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE; v_payment public.billing_payments%ROWTYPE; v_reserved BIGINT;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('under_review','approve','reject') OR p_reviewer_id IS NULL THEN RAISE EXCEPTION 'refund_review_invalid' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_reviewer_id AND role='ADMIN' AND status='ACTIVE') THEN
    RAISE EXCEPTION 'refund_reviewer_not_authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.requested_by=p_reviewer_id THEN RAISE EXCEPTION 'refund_review_not_authorized' USING ERRCODE='42501'; END IF;
  IF p_decision='approve' AND v_request.status IN ('approved','processing')
     AND v_request.reviewed_by=p_reviewer_id
     AND v_request.approved_amount_paise=p_approved_amount_paise
     AND v_request.entitlement_action=p_entitlement_action THEN
    RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_request.status,'approved_amount_paise',v_request.approved_amount_paise,'duplicate',TRUE);
  END IF;
  IF v_request.status NOT IN ('requested','under_review') THEN RAISE EXCEPTION 'refund_request_not_reviewable' USING ERRCODE='23514'; END IF;
  IF p_decision='under_review' THEN
    UPDATE public.billing_refund_requests SET status='under_review', reviewed_by=p_reviewer_id, reviewed_at=pg_catalog.clock_timestamp(), decision_note=NULLIF(btrim(p_decision_note),''), updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
    INSERT INTO public.billing_refund_review_events(refund_request_id,reviewer_id,decision,decision_note) VALUES(v_request.id,p_reviewer_id,'under_review',NULLIF(btrim(p_decision_note),''));
    RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status','under_review');
  ELSIF p_decision='reject' THEN
    UPDATE public.billing_refund_requests SET status='rejected', reviewed_by=p_reviewer_id, reviewed_at=pg_catalog.clock_timestamp(), decision_note=NULLIF(btrim(p_decision_note),''), updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
    INSERT INTO public.billing_refund_review_events(refund_request_id,reviewer_id,decision,decision_note) VALUES(v_request.id,p_reviewer_id,'rejected',NULLIF(btrim(p_decision_note),''));
    RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status','rejected');
  END IF;
  IF p_approved_amount_paise IS NULL OR p_approved_amount_paise <= 0 OR p_approved_amount_paise > v_request.requested_amount_paise OR p_entitlement_action IS NULL OR p_entitlement_action NOT IN ('retain','revoke') THEN
    RAISE EXCEPTION 'refund_approval_amount_or_entitlement_decision_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_payment FROM public.billing_payments WHERE id=v_request.payment_id AND organization_id=v_request.organization_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'captured' OR v_payment.signature_verified_at IS NULL THEN RAISE EXCEPTION 'refund_payment_not_refundable' USING ERRCODE='23514'; END IF;
  IF p_approved_amount_paise=v_payment.amount_paise-v_payment.amount_refunded_paise AND p_entitlement_action='retain' THEN
    RAISE EXCEPTION 'full_refund_cannot_retain_entitlement' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(sum(CASE WHEN status IN ('approved','processing') THEN approved_amount_paise ELSE requested_amount_paise END),0) INTO v_reserved
  FROM public.billing_refund_requests WHERE payment_id=v_request.payment_id AND id<>v_request.id AND status IN ('requested','under_review','approved','processing');
  IF p_approved_amount_paise > v_payment.amount_paise-v_payment.amount_refunded_paise-v_reserved THEN
    RAISE EXCEPTION 'refund_approval_exceeds_remaining_balance' USING ERRCODE='22023';
  END IF;
  UPDATE public.billing_refund_requests SET status='approved', approved_amount_paise=p_approved_amount_paise, entitlement_action=p_entitlement_action,
    reviewed_by=p_reviewer_id, reviewed_at=pg_catalog.clock_timestamp(), decision_note=NULLIF(btrim(p_decision_note),''), updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
  INSERT INTO public.billing_refund_review_events(refund_request_id,reviewer_id,decision,approved_amount_paise,entitlement_action,decision_note)
  VALUES(v_request.id,p_reviewer_id,'approved',p_approved_amount_paise,p_entitlement_action,NULLIF(btrim(p_decision_note),''));
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status','approved','approved_amount_paise',p_approved_amount_paise);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_billing_refund_processing(p_refund_request_id UUID,p_reviewer_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_reviewer_id AND role='ADMIN' AND status='ACTIVE') THEN RAISE EXCEPTION 'refund_reviewer_not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.reviewed_by<>p_reviewer_id OR v_request.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'refund_not_approved_for_processing' USING ERRCODE='42501'; END IF;
  UPDATE public.billing_refund_requests SET status='processing',updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'payment_id',v_request.payment_id,'organization_id',v_request.organization_id,'approved_amount_paise',v_request.approved_amount_paise,'provider_refund_id',v_request.provider_refund_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_billing_refund_provider_result(p_refund_request_id UUID,p_reviewer_id UUID,p_provider_refund_id TEXT,p_provider_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_reviewer_id AND role='ADMIN' AND status='ACTIVE') THEN RAISE EXCEPTION 'refund_reviewer_not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.reviewed_by<>p_reviewer_id OR v_request.status<>'processing' THEN RAISE EXCEPTION 'refund_not_processing' USING ERRCODE='23514'; END IF;
  IF p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$' OR p_provider_status NOT IN ('pending','processed','failed') THEN RAISE EXCEPTION 'refund_provider_response_invalid' USING ERRCODE='22023'; END IF;
  IF v_request.provider_refund_id IS NOT NULL AND v_request.provider_refund_id IS DISTINCT FROM p_provider_refund_id THEN RAISE EXCEPTION 'refund_provider_identity_conflict' USING ERRCODE='23514'; END IF;
  UPDATE public.billing_refund_requests SET provider_refund_id=COALESCE(provider_refund_id,p_provider_refund_id),provider_refund_status=p_provider_status,
    provider_refund_created_at=COALESCE(provider_refund_created_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status','processing');
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_billing_refund_event(p_refund_request_id UUID,p_provider_refund_id TEXT,p_payment_id TEXT,p_amount_paise BIGINT,p_provider_status TEXT,p_payment_amount_refunded_paise BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE; v_payment public.billing_payments%ROWTYPE; v_next TEXT;
BEGIN
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.provider_refund_id IS DISTINCT FROM p_provider_refund_id THEN RAISE EXCEPTION 'refund_event_not_matched_to_approved_request' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_payment FROM public.billing_payments WHERE id=v_request.payment_id AND organization_id=v_request.organization_id FOR UPDATE;
  IF NOT FOUND OR v_payment.razorpay_payment_id IS DISTINCT FROM p_payment_id OR p_amount_paise IS DISTINCT FROM v_request.approved_amount_paise
     OR p_payment_amount_refunded_paise IS NULL OR p_payment_amount_refunded_paise > v_payment.amount_paise
     OR p_payment_amount_refunded_paise IS DISTINCT FROM v_payment.amount_refunded_paise THEN RAISE EXCEPTION 'refund_event_payment_mismatch' USING ERRCODE='23514'; END IF;
  IF v_request.status IN ('partially_refunded','refunded','failed') THEN
    IF (v_request.status IN ('partially_refunded','refunded') AND p_provider_status='processed')
       OR (v_request.status='failed' AND p_provider_status='failed') THEN
      RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_request.status,'duplicate',TRUE);
    END IF;
    RAISE EXCEPTION 'refund_event_conflicts_with_final_state' USING ERRCODE='23514';
  END IF;
  IF v_request.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'refund_event_not_matched_to_approved_request' USING ERRCODE='23514'; END IF;
  IF p_provider_status='processed' THEN
    IF p_payment_amount_refunded_paise < v_request.approved_amount_paise THEN RAISE EXCEPTION 'refund_not_reflected_by_provider_payment' USING ERRCODE='23514'; END IF;
    v_next := CASE WHEN p_payment_amount_refunded_paise=v_payment.amount_paise THEN 'refunded' ELSE 'partially_refunded' END;
  ELSIF p_provider_status='failed' THEN v_next := 'failed';
  ELSIF p_provider_status='pending' THEN v_next := 'processing';
  ELSE RAISE EXCEPTION 'refund_provider_status_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.billing_refund_requests SET status=v_next,provider_refund_status=p_provider_status,
    completed_at=CASE WHEN v_next IN ('partially_refunded','refunded','failed') THEN pg_catalog.clock_timestamp() ELSE completed_at END,
    updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_next);
END;
$function$;

CREATE OR REPLACE FUNCTION public.begin_subscription_cancellation(p_organization_id UUID,p_owner_id UUID,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_subscription public.organization_subscriptions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_owner_id AND organization_id=p_organization_id AND role='OWNER' AND status='ACTIVE') THEN RAISE EXCEPTION 'subscription_owner_not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_subscription FROM public.organization_subscriptions WHERE organization_id=p_organization_id AND is_current IS TRUE FOR UPDATE;
  IF NOT FOUND OR v_subscription.status<>'active' OR v_subscription.current_period_end IS NULL OR v_subscription.current_period_end<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'subscription_not_cancellable' USING ERRCODE='23514'; END IF;
  IF v_subscription.cancel_at_period_end AND v_subscription.cancellation_request_status='scheduled' THEN
    RETURN pg_catalog.jsonb_build_object('id',v_subscription.id,'request_id',v_subscription.cancellation_request_id,'status','scheduled','effective_at',v_subscription.cancellation_effective_at,'duplicate',TRUE);
  END IF;
  IF v_subscription.cancellation_request_status='pending' THEN
    RETURN pg_catalog.jsonb_build_object('id',v_subscription.id,'provider_subscription_id',v_subscription.razorpay_subscription_id,'provider_plan_id',v_subscription.razorpay_plan_id,'request_id',v_subscription.cancellation_request_id,'status','pending','effective_at',v_subscription.current_period_end,'duplicate',TRUE);
  END IF;
  UPDATE public.organization_subscriptions SET cancellation_request_status='pending',cancellation_request_id=p_request_id,
    cancellation_requested_at=pg_catalog.clock_timestamp(),cancellation_effective_at=current_period_end,
    updated_at=pg_catalog.clock_timestamp() WHERE id=v_subscription.id;
  RETURN pg_catalog.jsonb_build_object('id',v_subscription.id,'provider_subscription_id',v_subscription.razorpay_subscription_id,
    'provider_plan_id',v_subscription.razorpay_plan_id,'request_id',p_request_id,'status','pending','effective_at',v_subscription.current_period_end,'duplicate',FALSE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_subscription_cancellation(p_organization_id UUID,p_subscription_id UUID,p_request_id UUID,p_provider_status TEXT,p_effective_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_subscription public.organization_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_subscription FROM public.organization_subscriptions WHERE id=p_subscription_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_subscription.cancellation_request_id IS DISTINCT FROM p_request_id OR v_subscription.cancellation_request_status NOT IN ('pending','scheduled') THEN RAISE EXCEPTION 'cancellation_request_mismatch' USING ERRCODE='23514'; END IF;
  IF p_provider_status IS DISTINCT FROM 'active' OR p_effective_at IS DISTINCT FROM v_subscription.current_period_end OR p_effective_at<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'provider_cancellation_not_confirmed' USING ERRCODE='23514'; END IF;
  UPDATE public.organization_subscriptions SET cancel_at_period_end=TRUE,cancellation_request_status='scheduled',
    cancellation_effective_at=p_effective_at,cancellation_provider_status=p_provider_status,updated_at=pg_catalog.clock_timestamp()
  WHERE id=v_subscription.id;
  RETURN pg_catalog.jsonb_build_object('id',v_subscription.id,'status','scheduled','effective_at',p_effective_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_subscription_cancellation(p_organization_id UUID,p_subscription_id UUID,p_request_id UUID,p_provider_error_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
BEGIN
  UPDATE public.organization_subscriptions SET cancellation_request_status='failed',cancellation_provider_status=left(COALESCE(p_provider_error_code,'provider_error'),80),
    cancellation_effective_at=NULL,cancel_at_period_end=FALSE,updated_at=pg_catalog.clock_timestamp()
  WHERE id=p_subscription_id AND organization_id=p_organization_id AND cancellation_request_id=p_request_id AND cancellation_request_status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'cancellation_failure_record_mismatch' USING ERRCODE='23514'; END IF;
  RETURN pg_catalog.jsonb_build_object('status','failed');
END;
$function$;

-- Entitlement remains paid-through for a scheduled cancellation. A partial
-- refund only preserves access when its completed internal review explicitly
-- chose retain; any unmatched or unreviewed partial refund fails closed.
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

-- A provider cancellation requested for period end must not shorten the
-- paid-through period if Razorpay sends a cancellation status early.
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
  ELSIF v_subscription.cancel_at_period_end IS TRUE AND v_subscription.cancellation_effective_at IS NOT NULL
        AND v_paid_at IS NOT NULL AND v_paid_at >= v_subscription.cancellation_effective_at THEN
    -- A provider charge after the agreed cancellation boundary is recorded,
    -- but cannot renew or restore this organization's paid entitlement.
    v_next_status := 'expired';
  ELSIF p_provider_subscription_status = 'cancelled' AND v_subscription.cancel_at_period_end IS TRUE AND v_period_end > v_now THEN
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
      cancellation_request_status = CASE
        WHEN cancel_at_period_end IS TRUE AND v_next_status IN ('cancelled','expired') THEN 'completed'
        ELSE cancellation_request_status
      END,
      cancellation_provider_status = p_provider_subscription_status,
      updated_at = v_now
  WHERE id = v_subscription.id AND organization_id = p_organization_id;

  RETURN pg_catalog.jsonb_build_object('status', v_next_status, 'paymentStatus', v_payment_status);
END;
$function$;


REVOKE ALL ON FUNCTION public.request_billing_refund(UUID,UUID,UUID,BIGINT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_billing_refund_request(UUID,UUID,TEXT,BIGINT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_billing_refund_processing(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_billing_refund_provider_result(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_billing_refund_event(UUID,TEXT,TEXT,BIGINT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_subscription_cancellation(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_subscription_cancellation(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_subscription_cancellation(UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.organization_has_active_paid_entitlement(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.apply_verified_razorpay_payment(UUID,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TIMESTAMPTZ,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_billing_refund(UUID,UUID,UUID,BIGINT,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_billing_refund_request(UUID,UUID,TEXT,BIGINT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_billing_refund_processing(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_billing_refund_provider_result(UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_billing_refund_event(UUID,TEXT,TEXT,BIGINT,TEXT,BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_subscription_cancellation(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_subscription_cancellation(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_subscription_cancellation(UUID,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.organization_has_active_paid_entitlement(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_verified_razorpay_payment(UUID,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TIMESTAMPTZ,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
COMMIT;
