-- Durable, single-use email OTP tickets for LOGIN and INVITATION purposes.
-- No RLS policy or table grants are changed by this migration.

ALTER TABLE public.email_otps
  ADD COLUMN IF NOT EXISTS ticket_id UUID,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS email_otps_ticket_id_uidx
  ON public.email_otps (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_email_otp_ticket(
  p_ticket_id UUID,
  p_email TEXT,
  p_purpose TEXT,
  p_otp_hash TEXT,
  p_resend_after TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_resend_after TIMESTAMPTZ;
  v_send_count INTEGER;
BEGIN
  IF p_ticket_id IS NULL
     OR v_email IS NULL OR v_email = ''
     OR p_purpose IS NULL OR p_purpose NOT IN ('LOGIN', 'INVITATION')
     OR p_otp_hash IS NULL OR p_otp_hash !~ '^[a-f0-9]{64}$'
     OR p_resend_after IS NULL
     OR p_expires_at IS NULL
     OR p_resend_after <= v_now
     OR p_expires_at <= v_now
     OR p_resend_after > p_expires_at
     OR p_expires_at > v_now + INTERVAL '15 minutes' THEN
    RAISE EXCEPTION 'invalid_email_otp_ticket' USING ERRCODE = '22023';
  END IF;

  -- Serialize issuance per normalized email and purpose across API instances.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_email || ':' || p_purpose, 0)
  );

  SELECT e.resend_after
    INTO v_resend_after
    FROM public.email_otps AS e
   WHERE e.email = v_email
     AND e.purpose = p_purpose
     AND e.used = FALSE
   ORDER BY e.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND AND v_resend_after > v_now THEN
    RETURN pg_catalog.jsonb_build_object(
      'issued', FALSE,
      'reason', 'cooldown',
      'resend_after', v_resend_after,
      'cooldown_seconds', GREATEST(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', v_resend_after - v_now))::INTEGER
      )
    );
  END IF;

  SELECT pg_catalog.count(*)::INTEGER
    INTO v_send_count
    FROM public.email_otps AS e
   WHERE e.email = v_email
     AND e.purpose = p_purpose
     AND e.created_at >= v_now - INTERVAL '15 minutes';

  IF v_send_count >= 5 THEN
    RETURN pg_catalog.jsonb_build_object('issued', FALSE, 'reason', 'rate_limited');
  END IF;

  -- Resending invalidates every older ticket before the new row is created.
  UPDATE public.email_otps AS e
     SET used = TRUE
   WHERE e.email = v_email
     AND e.purpose = p_purpose
     AND e.used = FALSE;

  INSERT INTO public.email_otps (
    ticket_id, email, purpose, otp_hash, attempts, resend_after, expires_at,
    used, created_at, verified_at
  ) VALUES (
    p_ticket_id, v_email, p_purpose, p_otp_hash, 0, p_resend_after, p_expires_at,
    FALSE, v_now, NULL
  );

  RETURN pg_catalog.jsonb_build_object('issued', TRUE, 'resend_after', p_resend_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_email_otp_verification(
  p_ticket_id UUID,
  p_email TEXT,
  p_purpose TEXT,
  p_is_valid BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_row public.email_otps%ROWTYPE;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_attempts INTEGER;
BEGIN
  IF p_ticket_id IS NULL
     OR v_email IS NULL OR v_email = ''
     OR p_purpose IS NULL OR p_purpose NOT IN ('LOGIN', 'INVITATION')
     OR p_is_valid IS NULL THEN
    RAISE EXCEPTION 'invalid_email_otp_verification' USING ERRCODE = '22023';
  END IF;

  SELECT e.*
    INTO v_row
    FROM public.email_otps AS e
   WHERE e.ticket_id = p_ticket_id
     AND e.email = v_email
     AND e.purpose = p_purpose
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'reason', 'unavailable');
  END IF;

  IF v_row.expires_at <= v_now THEN
    UPDATE public.email_otps AS e SET used = TRUE
     WHERE e.id = v_row.id AND e.used = FALSE;
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'reason', 'expired');
  END IF;

  IF v_row.used THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'reason', 'consumed');
  END IF;

  IF v_row.attempts >= 5 THEN
    UPDATE public.email_otps AS e SET used = TRUE
     WHERE e.id = v_row.id AND e.used = FALSE;
    RETURN pg_catalog.jsonb_build_object(
      'verified', FALSE, 'reason', 'locked', 'attempts', v_row.attempts
    );
  END IF;

  IF NOT p_is_valid THEN
    v_attempts := v_row.attempts + 1;
    UPDATE public.email_otps AS e
       SET attempts = v_attempts,
           used = (v_attempts >= 5)
     WHERE e.id = v_row.id;
    RETURN pg_catalog.jsonb_build_object(
      'verified', FALSE,
      'reason', CASE WHEN v_attempts >= 5 THEN 'locked' ELSE 'invalid' END,
      'attempts', v_attempts
    );
  END IF;

  UPDATE public.email_otps AS e
     SET used = TRUE, verified_at = v_now
   WHERE e.id = v_row.id AND e.used = FALSE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('verified', FALSE, 'reason', 'consumed');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'verified', TRUE, 'attempts', v_row.attempts, 'verified_at', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_email_otp_ticket(
  p_ticket_id UUID,
  p_email TEXT,
  p_purpose TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_ticket_id IS NULL
     OR p_email IS NULL OR pg_catalog.lower(pg_catalog.btrim(p_email)) = ''
     OR p_purpose IS NULL OR p_purpose NOT IN ('LOGIN', 'INVITATION') THEN
    RAISE EXCEPTION 'invalid_email_otp_ticket' USING ERRCODE = '22023';
  END IF;

  UPDATE public.email_otps AS e
     SET used = TRUE
   WHERE e.ticket_id = p_ticket_id
     AND e.email = pg_catalog.lower(pg_catalog.btrim(p_email))
     AND e.purpose = p_purpose
     AND e.used = FALSE;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_email_otp_ticket(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_email_otp_verification(UUID, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_email_otp_ticket(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_email_otp_ticket(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_email_otp_verification(UUID, TEXT, TEXT, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_email_otp_ticket(UUID, TEXT, TEXT)
  TO service_role;
