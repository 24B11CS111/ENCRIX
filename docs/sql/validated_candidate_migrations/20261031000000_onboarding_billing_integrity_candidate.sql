BEGIN;
-- Durable registration OTP tickets and billing identity/state protections.
-- Apply after 20261030000000_owner_business_billing_details.sql.
-- Compatibility preflights are documented in docs/owner-onboarding-billing-recovery.md.

CREATE TABLE IF NOT EXISTS public.registration_otp_attempts (
    ticket_id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    otp_hash TEXT,
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Upgrade an earlier, partially applied version without rewriting its rows.
ALTER TABLE public.registration_otp_attempts ADD COLUMN IF NOT EXISTS otp_hash TEXT;
ALTER TABLE public.registration_otp_attempts ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.registration_otp_attempts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
ALTER TABLE public.registration_otp_attempts ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.registration_otp_attempts ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.pending_registrations ADD COLUMN IF NOT EXISTS otp_ticket_id UUID;
CREATE INDEX IF NOT EXISTS registration_otp_attempts_email_created_at_idx
  ON public.registration_otp_attempts(email, created_at DESC);
ALTER TABLE public.registration_otp_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_otp_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.registration_otp_attempts FROM service_role;

-- Replace the named policy if a prior partial run created it.
DROP POLICY IF EXISTS "Service role manages registration OTP attempts" ON public.registration_otp_attempts;
CREATE POLICY "Service role manages registration OTP attempts"
  ON public.registration_otp_attempts FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- This is the only RPC that may issue ticket rows. It is service-role-only and
-- atomically stores the pending registration and its OTP hash/ticket.
CREATE OR REPLACE FUNCTION public.issue_registration_otp_ticket(
 p_ticket_id UUID, p_email TEXT, p_otp_hash TEXT, p_expires_at TIMESTAMPTZ,
 p_resend_after TIMESTAMPTZ, p_phone_number TEXT, p_company_name TEXT,
 p_owner_name TEXT, p_industry TEXT, p_company_size TEXT, p_business_email TEXT,
 p_business_phone TEXT, p_business_location TEXT, p_website_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_email TEXT := lower(btrim(p_email));
  v_pending_id UUID;
  v_pending_count INTEGER;
  v_existing_resend_after TIMESTAMPTZ;
  v_send_count INTEGER;
  v_oldest_send TIMESTAMPTZ;
BEGIN
  IF p_ticket_id IS NULL OR v_email IS NULL OR v_email = '' OR p_otp_hash IS NULL
     OR p_otp_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL OR p_expires_at <= v_now
     OR p_expires_at > v_now + INTERVAL '15 minutes'
     OR p_resend_after IS NULL OR p_resend_after <= v_now
     OR p_resend_after > p_expires_at
     OR p_company_name IS NULL OR p_owner_name IS NULL THEN
    RAISE EXCEPTION 'registration_otp_issue_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_email, 0));
  SELECT count(*) INTO v_pending_count
    FROM public.pending_registrations WHERE lower(email) = v_email;
  IF v_pending_count > 1 THEN
    RAISE EXCEPTION 'pending_registration_ambiguous' USING ERRCODE = '23505';
  END IF;
  IF v_pending_count = 1 THEN
    SELECT id, resend_after INTO v_pending_id, v_existing_resend_after
      FROM public.pending_registrations WHERE lower(email) = v_email
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;
  IF v_existing_resend_after > v_now THEN
    RETURN jsonb_build_object('issued', FALSE, 'resend_after', v_existing_resend_after);
  END IF;

  SELECT count(*)::INTEGER, min(created_at)
    INTO v_send_count, v_oldest_send
    FROM public.registration_otp_attempts
   WHERE email = v_email
     AND created_at >= v_now - INTERVAL '15 minutes';
  IF v_send_count >= 5 THEN
    RETURN jsonb_build_object(
      'issued', FALSE,
      'rate_limited', TRUE,
      'retry_after', v_oldest_send + INTERVAL '15 minutes'
    );
  END IF;

  INSERT INTO public.registration_otp_attempts(ticket_id, email, otp_hash, expires_at, created_at)
  VALUES (p_ticket_id, v_email, p_otp_hash, p_expires_at, v_now);

  IF v_pending_id IS NULL THEN
    INSERT INTO public.pending_registrations(
      email, phone_number, company_name, owner_name, industry, company_size,
      business_email, business_phone, business_location, website_url,
      otp_hash, otp_ticket_id, attempts, resend_after, expires_at, created_at
    ) VALUES (
      v_email, p_phone_number, p_company_name, p_owner_name, p_industry, p_company_size,
      p_business_email, p_business_phone, p_business_location, p_website_url,
      p_otp_hash, p_ticket_id, 0, p_resend_after, p_expires_at, v_now
    ) RETURNING id INTO v_pending_id;
  ELSE
    UPDATE public.pending_registrations SET
      email = v_email, phone_number = p_phone_number,
      company_name = p_company_name, owner_name = p_owner_name,
      industry = p_industry, company_size = p_company_size,
      business_email = p_business_email, business_phone = p_business_phone,
      business_location = p_business_location, website_url = p_website_url,
      otp_hash = p_otp_hash, otp_ticket_id = p_ticket_id, attempts = 0,
      resend_after = p_resend_after, expires_at = p_expires_at, created_at = v_now
    WHERE id = v_pending_id;
  END IF;

  -- Resends invalidate all previous tickets for this email, including a ticket
  -- issued concurrently before this pending-registration row was updated.
  UPDATE public.registration_otp_attempts
     SET consumed_at = COALESCE(consumed_at, v_now)
   WHERE email = v_email AND ticket_id <> p_ticket_id AND consumed_at IS NULL;

  RETURN jsonb_build_object('issued', TRUE, 'pending_registration_id', v_pending_id);
END; $$;
REVOKE ALL ON FUNCTION public.issue_registration_otp_ticket(UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_registration_otp_ticket(UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

-- Read-only status lookup: an unknown ticket is never materialized.
CREATE OR REPLACE FUNCTION public.get_registration_otp_attempts(p_ticket_id UUID, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.registration_otp_attempts%ROWTYPE; v_attempts SMALLINT;
BEGIN
  SELECT * INTO v_row FROM public.registration_otp_attempts
   WHERE ticket_id = p_ticket_id AND email = lower(btrim(p_email));
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_otp_unavailable' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object(
    'attempts', v_row.attempts, 'verified', v_row.verified_at IS NOT NULL,
    'consumed', v_row.consumed_at IS NOT NULL, 'expired', v_row.expires_at <= clock_timestamp()
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_registration_otp_attempts(UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_registration_otp_attempts(UUID,TEXT) TO service_role;

-- Atomic failure counting and verified-state transition. HMAC comparison is
-- performed by the handler with timingSafeEqual; this service-only RPC locks
-- and records the result against concurrent attempts and registration.
CREATE OR REPLACE FUNCTION public.complete_registration_otp_verification(
 p_ticket_id UUID, p_email TEXT, p_is_valid BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.registration_otp_attempts%ROWTYPE; v_attempts SMALLINT;
BEGIN
  IF p_is_valid IS NULL THEN RAISE EXCEPTION 'registration_otp_unavailable' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.registration_otp_attempts
   WHERE ticket_id = p_ticket_id AND email = lower(btrim(p_email)) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('verified', FALSE, 'unavailable', TRUE);
  END IF;
  IF v_row.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('verified', FALSE, 'consumed', TRUE);
  END IF;
  IF v_row.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('verified', FALSE, 'expired', TRUE);
  END IF;
  IF v_row.attempts >= 5 THEN
    RETURN jsonb_build_object('verified', FALSE, 'locked', TRUE, 'attempts', v_row.attempts);
  END IF;
  IF v_row.otp_hash IS NULL OR v_row.otp_hash !~ '^[0-9a-f]{64}$' OR NOT p_is_valid THEN
    UPDATE public.registration_otp_attempts
       SET attempts = LEAST(attempts + 1, 5)
     WHERE ticket_id = p_ticket_id
     RETURNING attempts INTO v_attempts;
    RETURN jsonb_build_object('verified', FALSE, 'locked', v_attempts >= 5, 'attempts', v_attempts);
  END IF;

  UPDATE public.registration_otp_attempts
     SET verified_at = COALESCE(verified_at, clock_timestamp())
   WHERE ticket_id = p_ticket_id
   RETURNING * INTO v_row;
  RETURN jsonb_build_object('verified', TRUE, 'attempts', v_row.attempts);
END; $$;
REVOKE ALL ON FUNCTION public.complete_registration_otp_verification(UUID,TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_registration_otp_verification(UUID,TEXT,BOOLEAN) TO service_role;

-- Remove the legacy arbitrary-ticket failure mutator from earlier partial runs.
DROP FUNCTION IF EXISTS public.record_registration_otp_failure(UUID,TEXT);

CREATE OR REPLACE FUNCTION public.cancel_registration_otp_ticket(p_ticket_id UUID, p_email TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.registration_otp_attempts
     SET consumed_at = COALESCE(consumed_at, clock_timestamp())
   WHERE ticket_id = p_ticket_id AND email = lower(btrim(p_email)) AND consumed_at IS NULL;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.cancel_registration_otp_ticket(UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_registration_otp_ticket(UUID,TEXT) TO service_role;

-- Preserve the existing RPC signature for callers, but treat all registration
-- details except owner ID/email/slug/ticket ID as untrusted and ignore them.
-- The ticket is locked and consumed in the same transaction as both inserts.
CREATE OR REPLACE FUNCTION public.create_owner_registration(
 p_owner_user_id UUID, p_email TEXT, p_full_name TEXT, p_phone TEXT,
 p_company_name TEXT, p_slug TEXT, p_industry TEXT, p_company_size TEXT,
 p_business_email TEXT, p_business_phone TEXT, p_business_location TEXT, p_website_url TEXT,
 p_ticket_id UUID DEFAULT NULL, p_ticket_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_ticket public.registration_otp_attempts%ROWTYPE;
  v_pending public.pending_registrations%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_email TEXT := lower(btrim(p_email));
BEGIN
  IF p_owner_user_id IS NULL OR p_ticket_id IS NULL OR v_email = '' OR p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'registration_otp_ticket_unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.registration_otp_attempts
   WHERE ticket_id = p_ticket_id AND email = v_email FOR UPDATE;
  IF NOT FOUND OR v_ticket.verified_at IS NULL OR v_ticket.consumed_at IS NOT NULL
     OR v_ticket.expires_at <= clock_timestamp() OR v_ticket.attempts >= 5 THEN
    RAISE EXCEPTION 'registration_otp_ticket_unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pending FROM public.pending_registrations
   WHERE lower(email) = v_email AND otp_ticket_id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_pending.otp_hash IS DISTINCT FROM v_ticket.otp_hash
     OR v_pending.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'registration_otp_ticket_unavailable' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organizations(
    name, slug, industry, company_size, business_email, business_phone,
    business_location, website_url, owner_id, status
  ) VALUES (
    v_pending.company_name, p_slug, COALESCE(v_pending.industry, 'General'),
    COALESCE(v_pending.company_size, '1-10'), v_pending.business_email,
    v_pending.business_phone, v_pending.business_location, v_pending.website_url,
    p_owner_user_id, 'ACTIVE'
  ) RETURNING * INTO v_org;

  INSERT INTO public.profiles(
    user_id, organization_id, full_name, email, phone,
    email_verified, phone_verified, role, status
  ) VALUES (
    p_owner_user_id, v_org.id, v_pending.owner_name, v_email, v_pending.phone_number,
    TRUE, FALSE, 'OWNER', 'ACTIVE'
  ) RETURNING * INTO v_profile;

  UPDATE public.registration_otp_attempts
     SET consumed_at = clock_timestamp()
   WHERE ticket_id = p_ticket_id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_otp_ticket_unavailable' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.pending_registrations WHERE id = v_pending.id AND otp_ticket_id = p_ticket_id;

  RETURN jsonb_build_object('organization', to_jsonb(v_org), 'profile', to_jsonb(v_profile));
END; $$;
REVOKE ALL ON FUNCTION public.create_owner_registration(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_owner_registration(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ) TO service_role;

-- A provider payment ID may be assigned once (NULL -> ID). Organization and
-- subscription identity are immutable; payment states cannot move backwards.
CREATE OR REPLACE FUNCTION public.protect_billing_payment_identity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
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
    OR (OLD.status = 'captured' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'billing_payment_status_transition_invalid' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('captured','refunded') THEN
    NEW.signature_verified_at := COALESCE(NEW.signature_verified_at, OLD.signature_verified_at);
    NEW.paid_at := COALESCE(NEW.paid_at, OLD.paid_at);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS protect_billing_payment_identity ON public.billing_payments;
CREATE TRIGGER protect_billing_payment_identity BEFORE UPDATE ON public.billing_payments
FOR EACH ROW EXECUTE FUNCTION public.protect_billing_payment_identity();
REVOKE ALL PRIVILEGES ON FUNCTION public.protect_billing_payment_identity() FROM PUBLIC, anon, authenticated, service_role;

-- Named constraint guards make a partially applied migration rerunnable.
DO $$
DECLARE v_definition TEXT;
BEGIN
  IF to_regclass('public.organization_subscriptions') IS NULL OR to_regclass('public.billing_payments') IS NULL THEN
    RAISE EXCEPTION 'Required billing foundation tables are missing; apply/verify the billing foundation before this migration.';
  END IF;

  SELECT lower(regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g')) INTO v_definition
    FROM pg_constraint WHERE conrelid = 'public.organization_subscriptions'::regclass
      AND conname = 'organization_subscriptions_amount_required';
  IF v_definition IS NULL THEN
    ALTER TABLE public.organization_subscriptions ADD CONSTRAINT organization_subscriptions_amount_required CHECK (
      entitlement_source <> 'razorpay' OR amount_paise IS NOT NULL
    );
  ELSIF v_definition NOT LIKE '%entitlement_source%' OR v_definition NOT LIKE '%razorpay%' OR
        v_definition NOT LIKE '%amount_paiseisnotnull%' OR v_definition NOT LIKE '%or%' OR
        NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.organization_subscriptions'::regclass AND conname = 'organization_subscriptions_amount_required') THEN
    RAISE EXCEPTION 'Existing organization_subscriptions_amount_required constraint differs or is not validated; inspect manually.';
  END IF;

  SELECT lower(regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g')) INTO v_definition
    FROM pg_constraint WHERE conrelid = 'public.billing_payments'::regclass
      AND conname = 'billing_payments_subscription_required';
  IF v_definition IS NULL THEN
    ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_subscription_required CHECK (subscription_id IS NOT NULL);
  ELSIF v_definition NOT LIKE '%subscription_idisnotnull%' OR
        NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.billing_payments'::regclass AND conname = 'billing_payments_subscription_required') THEN
    RAISE EXCEPTION 'Existing billing_payments_subscription_required constraint differs or is not validated; inspect manually.';
  END IF;

  SELECT lower(regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g')) INTO v_definition
    FROM pg_constraint WHERE conrelid = 'public.billing_payments'::regclass
      AND conname = 'billing_payments_status_timestamps';
  IF v_definition IS NULL THEN
    ALTER TABLE public.billing_payments ADD CONSTRAINT billing_payments_status_timestamps CHECK (
      (status <> 'captured' OR (paid_at IS NOT NULL AND signature_verified_at IS NOT NULL)) AND
      (status <> 'failed' OR failed_at IS NOT NULL)
    );
  ELSIF v_definition NOT LIKE '%status%' OR v_definition NOT LIKE '%captured%' OR
        v_definition NOT LIKE '%paid_atisnotnull%' OR v_definition NOT LIKE '%signature_verified_atisnotnull%' OR
        v_definition NOT LIKE '%failed%' OR v_definition NOT LIKE '%failed_atisnotnull%' OR
        NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.billing_payments'::regclass AND conname = 'billing_payments_status_timestamps') THEN
    RAISE EXCEPTION 'Existing billing_payments_status_timestamps constraint differs or is not validated; inspect manually.';
  END IF;
END $$;

COMMIT;
