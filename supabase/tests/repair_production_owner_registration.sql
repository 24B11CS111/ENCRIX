-- Forward repair for ENCRIX Owner Registration schema and RPCs
-- Idempotent, fail-closed, transaction-safe, non-destructive.
BEGIN;

DO $preflight$
BEGIN
  -- Verify foundational tables exist
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.pending_registrations') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_FAILED: Baseline tables (organizations, profiles, pending_registrations) are missing.';
  END IF;

  -- Verify Supabase roles exist
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAILED: Required Supabase API roles are missing.';
  END IF;
END;
$preflight$;

-- 1. Organizations columns for owner business details
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS business_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS business_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS business_location VARCHAR(500),
    ADD COLUMN IF NOT EXISTS website_url TEXT;

-- 2. Pending registrations columns
ALTER TABLE public.pending_registrations
    ADD COLUMN IF NOT EXISTS business_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS business_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS business_location VARCHAR(500),
    ADD COLUMN IF NOT EXISTS website_url TEXT,
    ADD COLUMN IF NOT EXISTS otp_ticket_id UUID;

-- 3. Idempotency unique constraints & indexes
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_lower
    ON public.profiles (LOWER(email))
    WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_id_unique
    ON public.organizations (owner_id);

-- 4. Registration OTP attempts table
CREATE TABLE IF NOT EXISTS public.registration_otp_attempts (
    ticket_id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    otp_hash TEXT,
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE public.registration_otp_attempts
  ADD COLUMN IF NOT EXISTS otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp();

ALTER TABLE public.registration_otp_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_otp_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.registration_otp_attempts FROM service_role;

DROP POLICY IF EXISTS "Service role manages registration OTP attempts" ON public.registration_otp_attempts;
CREATE POLICY "Service role manages registration OTP attempts"
  ON public.registration_otp_attempts FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE INDEX IF NOT EXISTS registration_otp_attempts_email_created_at_idx
  ON public.registration_otp_attempts(email, created_at DESC);

-- 5. issue_registration_otp_ticket RPC
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

-- 6. get_registration_otp_attempts RPC
CREATE OR REPLACE FUNCTION public.get_registration_otp_attempts(p_ticket_id UUID, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.registration_otp_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.registration_otp_attempts
   WHERE ticket_id = p_ticket_id AND email = pg_catalog.lower(pg_catalog.btrim(p_email));
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_otp_unavailable' USING ERRCODE = '22023'; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'attempts', v_row.attempts, 'verified', v_row.verified_at IS NOT NULL,
    'consumed', v_row.consumed_at IS NOT NULL, 'expired', v_row.expires_at <= pg_catalog.clock_timestamp()
  );
END; $$;

REVOKE ALL ON FUNCTION public.get_registration_otp_attempts(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_registration_otp_attempts(UUID, TEXT) TO service_role;

-- 7. complete_registration_otp_verification RPC
CREATE OR REPLACE FUNCTION public.complete_registration_otp_verification(
 p_ticket_id UUID, p_email TEXT, p_is_valid BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.registration_otp_attempts%ROWTYPE; v_attempts SMALLINT;
BEGIN
  IF p_is_valid IS NULL THEN RAISE EXCEPTION 'registration_otp_unavailable' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.registration_otp_attempts
   WHERE ticket_id = p_ticket_id AND email = pg_catalog.lower(pg_catalog.btrim(p_email)) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'unavailable', TRUE);
  END IF;
  IF v_row.consumed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'consumed', TRUE);
  END IF;
  IF v_row.expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'expired', TRUE);
  END IF;
  IF v_row.attempts >= 5 THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'locked', TRUE, 'attempts', v_row.attempts);
  END IF;
  IF v_row.otp_hash IS NULL OR v_row.otp_hash !~ '^[0-9a-f]{64}$' OR NOT p_is_valid THEN
    UPDATE public.registration_otp_attempts
       SET attempts = LEAST(attempts + 1, 5)
     WHERE ticket_id = p_ticket_id
     RETURNING attempts INTO v_attempts;
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'locked', v_attempts >= 5, 'attempts', v_attempts);
  END IF;

  UPDATE public.registration_otp_attempts
     SET verified_at = COALESCE(verified_at, pg_catalog.clock_timestamp())
   WHERE ticket_id = p_ticket_id
   RETURNING * INTO v_row;
  RETURN pg_catalog.jsonb_build_object('verified', TRUE, 'attempts', v_row.attempts);
END; $$;

REVOKE ALL ON FUNCTION public.complete_registration_otp_verification(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_registration_otp_verification(UUID, TEXT, BOOLEAN) TO service_role;

-- 8. cancel_registration_otp_ticket RPC
CREATE OR REPLACE FUNCTION public.cancel_registration_otp_ticket(p_ticket_id UUID, p_email TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.registration_otp_attempts
     SET consumed_at = COALESCE(consumed_at, pg_catalog.clock_timestamp())
   WHERE ticket_id = p_ticket_id AND email = pg_catalog.lower(pg_catalog.btrim(p_email)) AND consumed_at IS NULL;
  RETURN FOUND;
END; $$;

REVOKE ALL ON FUNCTION public.cancel_registration_otp_ticket(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_registration_otp_ticket(UUID, TEXT) TO service_role;

-- 9. create_owner_registration RPC
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
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF p_owner_user_id IS NULL OR p_ticket_id IS NULL OR v_email = '' OR p_slug IS NULL OR pg_catalog.btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'registration_otp_ticket_unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.registration_otp_attempts
   WHERE ticket_id = p_ticket_id AND email = v_email FOR UPDATE;
  IF NOT FOUND OR v_ticket.verified_at IS NULL OR v_ticket.consumed_at IS NOT NULL
     OR v_ticket.expires_at <= v_now OR v_ticket.attempts >= 5 THEN
    RAISE EXCEPTION 'registration_otp_ticket_unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pending FROM public.pending_registrations
   WHERE pg_catalog.lower(email) = v_email AND otp_ticket_id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_pending.otp_hash IS DISTINCT FROM v_ticket.otp_hash
     OR v_pending.expires_at <= v_now THEN
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
     SET consumed_at = v_now
   WHERE ticket_id = p_ticket_id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration_otp_ticket_unavailable' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.pending_registrations WHERE id = v_pending.id AND otp_ticket_id = p_ticket_id;

  RETURN pg_catalog.jsonb_build_object('organization', pg_catalog.to_jsonb(v_org), 'profile', pg_catalog.to_jsonb(v_profile));
END; $$;

REVOKE ALL ON FUNCTION public.create_owner_registration(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_owner_registration(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ
) TO service_role;

COMMIT;
