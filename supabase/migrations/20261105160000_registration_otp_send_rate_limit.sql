-- Enforce the configured registration OTP send cap across server instances.
-- LOGIN and INVITATION continue to use their existing generic OTP RPCs.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.registration_otp_attempts') IS NULL
     OR to_regclass('public.pending_registrations') IS NULL
     OR to_regprocedure(
       'public.issue_registration_otp_ticket(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Registration OTP prerequisites are missing; inspect before retrying.';
  END IF;
END;
$preflight$;

ALTER TABLE public.registration_otp_attempts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp();
ALTER TABLE public.registration_otp_attempts
  ALTER COLUMN created_at SET DEFAULT pg_catalog.clock_timestamp(),
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS registration_otp_attempts_email_created_at_idx
  ON public.registration_otp_attempts(email, created_at DESC);

CREATE OR REPLACE FUNCTION public.issue_registration_otp_ticket(
 p_ticket_id UUID, p_email TEXT, p_otp_hash TEXT, p_expires_at TIMESTAMPTZ,
 p_resend_after TIMESTAMPTZ, p_phone_number TEXT, p_company_name TEXT,
 p_owner_name TEXT, p_industry TEXT, p_company_size TEXT, p_business_email TEXT,
 p_business_phone TEXT, p_business_location TEXT, p_website_url TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
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

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));
  SELECT count(*) INTO v_pending_count
    FROM public.pending_registrations WHERE pg_catalog.lower(email) = v_email;
  IF v_pending_count > 1 THEN
    RAISE EXCEPTION 'pending_registration_ambiguous' USING ERRCODE = '23505';
  END IF;
  IF v_pending_count = 1 THEN
    SELECT id, resend_after INTO v_pending_id, v_existing_resend_after
      FROM public.pending_registrations
     WHERE pg_catalog.lower(email) = v_email
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
  END IF;
  IF v_existing_resend_after > v_now THEN
    RETURN pg_catalog.jsonb_build_object('issued', FALSE, 'resend_after', v_existing_resend_after);
  END IF;

  SELECT count(*)::INTEGER, min(created_at)
    INTO v_send_count, v_oldest_send
    FROM public.registration_otp_attempts
   WHERE email = v_email
     AND created_at >= v_now - INTERVAL '15 minutes';
  IF v_send_count >= 5 THEN
    RETURN pg_catalog.jsonb_build_object(
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

  UPDATE public.registration_otp_attempts
     SET consumed_at = COALESCE(consumed_at, v_now)
   WHERE email = v_email AND ticket_id <> p_ticket_id AND consumed_at IS NULL;

  RETURN pg_catalog.jsonb_build_object('issued', TRUE, 'pending_registration_id', v_pending_id);
END; $$;

REVOKE ALL ON FUNCTION public.issue_registration_otp_ticket(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_registration_otp_ticket(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMIT;
