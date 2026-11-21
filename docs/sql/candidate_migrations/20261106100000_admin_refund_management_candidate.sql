-- Forward-only administrator refund audit and duplicate-processing hardening.
-- Requires 20261105170000_billing_refund_cancellation_workflows.sql.
-- This migration adds audit data only; it does not alter payment amounts.
-- Recovery: the transaction rolls back on failure. After commit, preserve the
-- audit trail and use a reviewed forward correction; never replay provider work
-- unless the stable refund request idempotency key has been reconciled.
BEGIN;

DO $prerequisites$
BEGIN
  IF pg_catalog.to_regclass('public.billing_refund_requests') IS NULL
     OR pg_catalog.to_regclass('public.billing_refund_review_events') IS NULL
     OR pg_catalog.to_regclass('public.billing_payments') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regprocedure('public.review_billing_refund_request(uuid,uuid,text,bigint,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.claim_billing_refund_processing(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.record_billing_refund_provider_result(uuid,uuid,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.reconcile_billing_refund_event(uuid,text,text,bigint,text,bigint)') IS NULL THEN
    RAISE EXCEPTION 'Refund management prerequisites are missing; inspect migration state before applying.';
  END IF;
END;
$prerequisites$;

DO $column_conflicts$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.billing_refund_requests'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname IN ('provider_claim_token','provider_claimed_at')
      AND ((a.attname='provider_claim_token' AND a.atttypid<>'pg_catalog.uuid'::regtype)
        OR (a.attname='provider_claimed_at' AND a.atttypid<>'pg_catalog.timestamptz'::regtype))
  ) THEN RAISE EXCEPTION 'Refund provider claim columns conflict with required types.'; END IF;
END;
$column_conflicts$;

ALTER TABLE public.billing_refund_requests
  ADD COLUMN IF NOT EXISTS provider_claim_token UUID,
  ADD COLUMN IF NOT EXISTS provider_claimed_at TIMESTAMPTZ;

CREATE TABLE public.billing_refund_audit_events (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  refund_request_id UUID NOT NULL REFERENCES public.billing_refund_requests(id) ON DELETE RESTRICT,
  actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'request_created','review_started','approved','rejected','processing_started',
    'provider_submitted','provider_pending','provider_completed','provider_failed'
  )),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  decision_reason TEXT,
  amount_paise BIGINT CHECK (amount_paise IS NULL OR amount_paise > 0),
  entitlement_action TEXT CHECK (entitlement_action IS NULL OR entitlement_action IN ('retain','revoke')),
  provider_refund_id TEXT,
  operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX billing_refund_audit_events_request_created_idx
  ON public.billing_refund_audit_events(refund_request_id, created_at DESC, id DESC);

ALTER TABLE public.billing_refund_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.billing_refund_audit_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.billing_refund_audit_events TO service_role;
CREATE POLICY billing_refund_audit_events_service_role
  ON public.billing_refund_audit_events FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

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
  INSERT INTO public.billing_refund_audit_events(refund_request_id,actor_profile_id,event_type,previous_status,new_status,decision_reason,amount_paise,operation_id)
  VALUES(v_existing.id,p_requester_id,'request_created',NULL,'requested',btrim(p_reason),p_requested_amount_paise,p_request_idempotency_key);
  RETURN pg_catalog.jsonb_build_object('id',v_existing.id,'status',v_existing.status,'duplicate',FALSE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_billing_refund_request(
  p_refund_request_id UUID, p_reviewer_id UUID, p_decision TEXT,
  p_approved_amount_paise BIGINT, p_entitlement_action TEXT, p_decision_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE; v_payment public.billing_payments%ROWTYPE; v_reserved BIGINT; v_next_status TEXT;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('under_review','approve','reject') OR p_reviewer_id IS NULL
     OR char_length(btrim(COALESCE(p_decision_note,''))) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'refund_review_invalid_or_reason_required' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_reviewer_id AND role='ADMIN' AND status='ACTIVE') THEN
    RAISE EXCEPTION 'refund_reviewer_not_authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.requested_by=p_reviewer_id THEN RAISE EXCEPTION 'refund_review_not_authorized' USING ERRCODE='42501'; END IF;
  IF p_decision='approve' AND v_request.status IN ('approved','processing')
     AND v_request.approved_amount_paise=p_approved_amount_paise
     AND v_request.entitlement_action=p_entitlement_action THEN
    RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_request.status,'approved_amount_paise',v_request.approved_amount_paise,'duplicate',TRUE);
  END IF;
  IF v_request.status NOT IN ('requested','under_review') THEN RAISE EXCEPTION 'refund_request_not_reviewable' USING ERRCODE='23514'; END IF;
  IF p_decision='under_review' THEN
    v_next_status := 'under_review';
    UPDATE public.billing_refund_requests SET status=v_next_status, reviewed_by=p_reviewer_id, reviewed_at=pg_catalog.clock_timestamp(), decision_note=btrim(p_decision_note), updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
    INSERT INTO public.billing_refund_review_events(refund_request_id,reviewer_id,decision,decision_note) VALUES(v_request.id,p_reviewer_id,'under_review',btrim(p_decision_note));
    INSERT INTO public.billing_refund_audit_events(refund_request_id,actor_profile_id,event_type,previous_status,new_status,decision_reason,operation_id)
      VALUES(v_request.id,p_reviewer_id,'review_started',v_request.status,v_next_status,btrim(p_decision_note),v_request.request_idempotency_key);
    RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_next_status);
  ELSIF p_decision='reject' THEN
    v_next_status := 'rejected';
    UPDATE public.billing_refund_requests SET status=v_next_status, reviewed_by=p_reviewer_id, reviewed_at=pg_catalog.clock_timestamp(), decision_note=btrim(p_decision_note), updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
    INSERT INTO public.billing_refund_review_events(refund_request_id,reviewer_id,decision,decision_note) VALUES(v_request.id,p_reviewer_id,'rejected',btrim(p_decision_note));
    INSERT INTO public.billing_refund_audit_events(refund_request_id,actor_profile_id,event_type,previous_status,new_status,decision_reason,operation_id)
      VALUES(v_request.id,p_reviewer_id,'rejected',v_request.status,v_next_status,btrim(p_decision_note),v_request.request_idempotency_key);
    RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_next_status);
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
  v_next_status := 'approved';
  UPDATE public.billing_refund_requests SET status=v_next_status, approved_amount_paise=p_approved_amount_paise, entitlement_action=p_entitlement_action,
    reviewed_by=p_reviewer_id, reviewed_at=pg_catalog.clock_timestamp(), decision_note=btrim(p_decision_note), updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
  INSERT INTO public.billing_refund_review_events(refund_request_id,reviewer_id,decision,approved_amount_paise,entitlement_action,decision_note)
  VALUES(v_request.id,p_reviewer_id,'approved',p_approved_amount_paise,p_entitlement_action,btrim(p_decision_note));
  INSERT INTO public.billing_refund_audit_events(refund_request_id,actor_profile_id,event_type,previous_status,new_status,decision_reason,amount_paise,entitlement_action,operation_id)
    VALUES(v_request.id,p_reviewer_id,'approved',v_request.status,v_next_status,btrim(p_decision_note),p_approved_amount_paise,p_entitlement_action,v_request.request_idempotency_key);
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_next_status,'approved_amount_paise',p_approved_amount_paise);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_billing_refund_processing(p_refund_request_id UUID,p_reviewer_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'refund_processing_claim_token_required' USING ERRCODE='42501';
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_billing_refund_processing(p_refund_request_id UUID,p_reviewer_id UUID,p_claim_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE; v_should_process BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_reviewer_id AND role='ADMIN' AND status='ACTIVE') THEN RAISE EXCEPTION 'refund_reviewer_not_authorized' USING ERRCODE='42501'; END IF;
  IF p_claim_token IS NULL THEN RAISE EXCEPTION 'refund_claim_token_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'refund_not_approved_for_processing' USING ERRCODE='42501'; END IF;
  IF v_request.provider_refund_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('id',v_request.id,'payment_id',v_request.payment_id,'organization_id',v_request.organization_id,
      'approved_amount_paise',v_request.approved_amount_paise,'provider_refund_id',v_request.provider_refund_id,'already_submitted',TRUE);
  END IF;
  IF v_request.status='approved' OR v_request.provider_claimed_at IS NULL
     OR v_request.provider_claimed_at < pg_catalog.clock_timestamp()-INTERVAL '2 minutes' THEN
    v_should_process := TRUE;
    UPDATE public.billing_refund_requests SET status='processing',provider_claim_token=p_claim_token,
      provider_claimed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
  END IF;
  IF v_should_process THEN
    INSERT INTO public.billing_refund_audit_events(refund_request_id,actor_profile_id,event_type,previous_status,new_status,decision_reason,amount_paise,entitlement_action,operation_id)
      VALUES(v_request.id,p_reviewer_id,'processing_started',v_request.status,'processing',v_request.decision_note,v_request.approved_amount_paise,v_request.entitlement_action,v_request.request_idempotency_key);
  END IF;
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'payment_id',v_request.payment_id,'organization_id',v_request.organization_id,
    'approved_amount_paise',v_request.approved_amount_paise,'provider_refund_id',NULL,'already_submitted',FALSE,
    'should_process',v_should_process,'in_progress',NOT v_should_process,'claim_token',CASE WHEN v_should_process THEN p_claim_token ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_billing_refund_provider_result(p_refund_request_id UUID,p_reviewer_id UUID,p_provider_refund_id TEXT,p_provider_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'refund_processing_claim_token_required' USING ERRCODE='42501';
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_billing_refund_provider_result(p_refund_request_id UUID,p_reviewer_id UUID,p_provider_refund_id TEXT,p_provider_status TEXT,p_claim_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE; v_event TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_reviewer_id AND role='ADMIN' AND status='ACTIVE') THEN RAISE EXCEPTION 'refund_reviewer_not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'processing'
     OR p_claim_token IS NULL OR v_request.provider_claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'refund_not_processing_or_claim_mismatch' USING ERRCODE='23514'; END IF;
  IF p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$' OR p_provider_status NOT IN ('pending','processed','failed') THEN RAISE EXCEPTION 'refund_provider_response_invalid' USING ERRCODE='22023'; END IF;
  IF v_request.provider_refund_id IS NOT NULL AND v_request.provider_refund_id IS DISTINCT FROM p_provider_refund_id THEN RAISE EXCEPTION 'refund_provider_identity_conflict' USING ERRCODE='23514'; END IF;
  v_event := CASE p_provider_status WHEN 'processed' THEN 'provider_submitted' WHEN 'failed' THEN 'provider_failed' ELSE 'provider_pending' END;
  UPDATE public.billing_refund_requests SET provider_refund_id=COALESCE(provider_refund_id,p_provider_refund_id),provider_refund_status=p_provider_status,
    status=CASE WHEN p_provider_status='failed' THEN 'failed' ELSE status END,
    completed_at=CASE WHEN p_provider_status='failed' THEN pg_catalog.clock_timestamp() ELSE completed_at END,
    provider_refund_created_at=COALESCE(provider_refund_created_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
  INSERT INTO public.billing_refund_audit_events(refund_request_id,actor_profile_id,event_type,previous_status,new_status,decision_reason,amount_paise,entitlement_action,provider_refund_id,operation_id)
    VALUES(v_request.id,p_reviewer_id,v_event,v_request.status,CASE WHEN p_provider_status='failed' THEN 'failed' ELSE v_request.status END,v_request.decision_note,v_request.approved_amount_paise,v_request.entitlement_action,p_provider_refund_id,v_request.request_idempotency_key);
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',CASE WHEN p_provider_status='failed' THEN 'failed' ELSE 'processing' END,'provider_refund_id',p_provider_refund_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_billing_refund_event(p_refund_request_id UUID,p_provider_refund_id TEXT,p_payment_id TEXT,p_amount_paise BIGINT,p_provider_status TEXT,p_payment_amount_refunded_paise BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE; v_payment public.billing_payments%ROWTYPE; v_next TEXT; v_event TEXT;
BEGIN
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.provider_refund_id IS DISTINCT FROM p_provider_refund_id THEN RAISE EXCEPTION 'refund_event_not_matched_to_approved_request' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_payment FROM public.billing_payments WHERE id=v_request.payment_id AND organization_id=v_request.organization_id FOR UPDATE;
  IF NOT FOUND OR v_payment.razorpay_payment_id IS DISTINCT FROM p_payment_id OR p_amount_paise IS DISTINCT FROM v_request.approved_amount_paise
     OR p_payment_amount_refunded_paise IS NULL OR p_payment_amount_refunded_paise > v_payment.amount_paise
     OR p_payment_amount_refunded_paise IS DISTINCT FROM v_payment.amount_refunded_paise THEN RAISE EXCEPTION 'refund_event_payment_mismatch' USING ERRCODE='23514'; END IF;
  IF v_request.status IN ('partially_refunded','refunded','failed') THEN
    IF (v_request.status IN ('partially_refunded','refunded') AND p_provider_status='processed') OR (v_request.status='failed' AND p_provider_status='failed') THEN
      RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_request.status,'duplicate',TRUE);
    END IF;
    RAISE EXCEPTION 'refund_event_conflicts_with_final_state' USING ERRCODE='23514';
  END IF;
  IF v_request.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'refund_event_not_matched_to_approved_request' USING ERRCODE='23514'; END IF;
  IF p_provider_status='processed' THEN
    IF p_payment_amount_refunded_paise < v_request.approved_amount_paise THEN RAISE EXCEPTION 'refund_not_reflected_by_provider_payment' USING ERRCODE='23514'; END IF;
    v_next := CASE WHEN p_payment_amount_refunded_paise=v_payment.amount_paise THEN 'refunded' ELSE 'partially_refunded' END;
    v_event := 'provider_completed';
  ELSIF p_provider_status='failed' THEN v_next := 'failed'; v_event := 'provider_failed';
  ELSIF p_provider_status='pending' THEN v_next := 'processing'; v_event := 'provider_pending';
  ELSE RAISE EXCEPTION 'refund_provider_status_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.billing_refund_requests SET status=v_next,provider_refund_status=p_provider_status,
    completed_at=CASE WHEN v_next IN ('partially_refunded','refunded','failed') THEN pg_catalog.clock_timestamp() ELSE completed_at END,
    updated_at=pg_catalog.clock_timestamp() WHERE id=v_request.id;
  INSERT INTO public.billing_refund_audit_events(refund_request_id,event_type,previous_status,new_status,decision_reason,amount_paise,entitlement_action,provider_refund_id,operation_id)
    VALUES(v_request.id,v_event,v_request.status,v_next,v_request.decision_note,v_request.approved_amount_paise,v_request.entitlement_action,p_provider_refund_id,v_request.request_idempotency_key);
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_next);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_billing_refund_webhook_result(
  p_refund_request_id UUID,p_provider_refund_id TEXT,p_payment_id TEXT,p_amount_paise BIGINT,p_provider_status TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_request public.billing_refund_requests%ROWTYPE; v_payment public.billing_payments%ROWTYPE; v_event TEXT;
BEGIN
  IF p_provider_refund_id IS NULL OR p_provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$'
     OR p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]+$'
     OR p_amount_paise IS NULL OR p_amount_paise<=0 OR p_provider_status NOT IN ('pending','processed','failed') THEN
    RAISE EXCEPTION 'refund_webhook_identity_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_request FROM public.billing_refund_requests WHERE id=p_refund_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('approved','processing','partially_refunded','refunded','failed')
     OR v_request.approved_amount_paise IS DISTINCT FROM p_amount_paise
     OR (v_request.provider_refund_id IS NOT NULL AND v_request.provider_refund_id IS DISTINCT FROM p_provider_refund_id) THEN
    RAISE EXCEPTION 'refund_webhook_not_bound_to_reviewed_request' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_payment FROM public.billing_payments
    WHERE id=v_request.payment_id AND organization_id=v_request.organization_id FOR UPDATE;
  IF NOT FOUND OR v_payment.razorpay_payment_id IS DISTINCT FROM p_payment_id THEN
    RAISE EXCEPTION 'refund_webhook_payment_mismatch' USING ERRCODE='23514';
  END IF;
  IF v_request.provider_refund_id IS NOT NULL THEN
    IF v_request.provider_refund_id IS DISTINCT FROM p_provider_refund_id THEN
      RAISE EXCEPTION 'refund_webhook_provider_identity_conflict' USING ERRCODE='23514';
    END IF;
    RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',v_request.status,'duplicate',TRUE);
  END IF;
  IF v_request.status NOT IN ('approved','processing') THEN
    RAISE EXCEPTION 'refund_webhook_not_bound_to_active_request' USING ERRCODE='23514';
  END IF;
  v_event := CASE p_provider_status WHEN 'processed' THEN 'provider_submitted' WHEN 'failed' THEN 'provider_failed' ELSE 'provider_pending' END;
  UPDATE public.billing_refund_requests SET provider_refund_id=p_provider_refund_id,
    provider_refund_status=p_provider_status,status=CASE WHEN p_provider_status='failed' THEN 'failed' ELSE status END,
    completed_at=CASE WHEN p_provider_status='failed' THEN pg_catalog.clock_timestamp() ELSE completed_at END,
    provider_refund_created_at=COALESCE(provider_refund_created_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp()
    WHERE id=v_request.id;
  INSERT INTO public.billing_refund_audit_events(refund_request_id,event_type,previous_status,new_status,decision_reason,amount_paise,entitlement_action,provider_refund_id,operation_id)
  VALUES(v_request.id,v_event,v_request.status,CASE WHEN p_provider_status='failed' THEN 'failed' ELSE v_request.status END,
    v_request.decision_note,v_request.approved_amount_paise,v_request.entitlement_action,p_provider_refund_id,v_request.request_idempotency_key);
  RETURN pg_catalog.jsonb_build_object('id',v_request.id,'status',CASE WHEN p_provider_status='failed' THEN 'failed' ELSE v_request.status END,'duplicate',FALSE);
END;
$function$;

REVOKE ALL ON FUNCTION public.request_billing_refund(UUID,UUID,UUID,BIGINT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_billing_refund_request(UUID,UUID,TEXT,BIGINT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_billing_refund_processing(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_billing_refund_processing(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_billing_refund_provider_result(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_billing_refund_provider_result(UUID,UUID,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_billing_refund_event(UUID,TEXT,TEXT,BIGINT,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_billing_refund_webhook_result(UUID,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_billing_refund(UUID,UUID,UUID,BIGINT,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_billing_refund_request(UUID,UUID,TEXT,BIGINT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_billing_refund_processing(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_billing_refund_provider_result(UUID,UUID,TEXT,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_billing_refund_event(UUID,TEXT,TEXT,BIGINT,TEXT,BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_billing_refund_webhook_result(UUID,TEXT,TEXT,BIGINT,TEXT) TO service_role;

COMMIT;
