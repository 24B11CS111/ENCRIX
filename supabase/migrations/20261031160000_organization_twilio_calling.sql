-- Organization-owned Twilio credentials and durable outbound-call idempotency.
-- Credentials are encrypted by the API before insertion. This table contains no
-- plaintext Auth Tokens and is inaccessible to browser roles.
BEGIN;

CREATE TABLE public.organization_twilio_credentials (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  twilio_phone_number TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organization_twilio_phone_e164_check
    CHECK (twilio_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT organization_twilio_key_id_check
    CHECK (key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  CONSTRAINT organization_twilio_nonce_base64_check
    CHECK (nonce ~ '^[A-Za-z0-9+/]{16}$'),
  CONSTRAINT organization_twilio_auth_tag_base64_check
    CHECK (auth_tag ~ '^[A-Za-z0-9+/]{22}==$'),
  CONSTRAINT organization_twilio_ciphertext_nonempty_check
    CHECK (length(ciphertext) > 0)
);

CREATE UNIQUE INDEX organization_twilio_active_phone_uidx
  ON public.organization_twilio_credentials(twilio_phone_number)
  WHERE status = 'ACTIVE';

ALTER TABLE public.organization_twilio_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_twilio_credentials FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.organization_twilio_credentials TO service_role;
DROP POLICY IF EXISTS organization_twilio_service_role_only
  ON public.organization_twilio_credentials;
CREATE POLICY organization_twilio_service_role_only
  ON public.organization_twilio_credentials FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- A caller-leg claim is a one-way transition, so concurrent/replayed status
-- callbacks can never create two customer legs for one click-to-call request.
ALTER TABLE public.call_bridges DROP CONSTRAINT IF EXISTS call_bridges_customer_leg_state_check;
ALTER TABLE public.call_bridges ADD CONSTRAINT call_bridges_customer_leg_state_check
  CHECK (customer_leg_state IN (
    'PENDING', 'CREATING', 'QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED',
    'BUSY', 'NO_ANSWER', 'CANCELED', 'FAILED', 'RECOVERY_REQUIRED'
  ));
ALTER TABLE public.call_bridges ADD COLUMN IF NOT EXISTS flow TEXT NOT NULL DEFAULT 'OUTBOUND';
ALTER TABLE public.call_bridges DROP CONSTRAINT IF EXISTS call_bridges_flow_check;
ALTER TABLE public.call_bridges ADD CONSTRAINT call_bridges_flow_check
  CHECK (flow IN ('OUTBOUND', 'INBOUND'));

CREATE TABLE public.telephony_inbound_attempts (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  provider_call_sid TEXT NOT NULL UNIQUE CHECK (provider_call_sid ~ '^CA[0-9A-Fa-f]{32}$'),
  outcome TEXT NOT NULL CHECK (outcome IN (
    'UNMATCHED_OR_AMBIGUOUS_NUMBER', 'NO_MATCHING_LEAD', 'AMBIGUOUS_LEAD',
    'NO_ELIGIBLE_TELECALLER', 'ROUTED', 'CALLER_UNAVAILABLE', 'PROVIDER_ERROR'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.telephony_inbound_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telephony_inbound_attempts FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS telephony_inbound_attempts_service_role_only
  ON public.telephony_inbound_attempts;
CREATE POLICY telephony_inbound_attempts_service_role_only
  ON public.telephony_inbound_attempts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Credential changes serialize with call preparation and are refused while a
-- call still needs the current Twilio account for signed callbacks/end control.
CREATE OR REPLACE FUNCTION public.save_organization_twilio_credentials(
  p_organization_id UUID,
  p_twilio_phone_number TEXT,
  p_key_id TEXT,
  p_nonce TEXT,
  p_ciphertext TEXT,
  p_auth_tag TEXT,
  p_updated_by UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM 1 FROM public.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_updated_by AND p.organization_id = p_organization_id
     AND p.role = 'OWNER' AND p.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_owner_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.calls c
     WHERE c.organization_id = p_organization_id
       AND c.status IN ('INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS')
  ) THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.organization_twilio_credentials(
    organization_id, twilio_phone_number, key_id, nonce, ciphertext, auth_tag,
    status, updated_by, updated_at
  ) VALUES (
    p_organization_id, p_twilio_phone_number, p_key_id, p_nonce, p_ciphertext, p_auth_tag,
    'ACTIVE', p_updated_by, pg_catalog.clock_timestamp()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    twilio_phone_number = EXCLUDED.twilio_phone_number,
    key_id = EXCLUDED.key_id,
    nonce = EXCLUDED.nonce,
    ciphertext = EXCLUDED.ciphertext,
    auth_tag = EXCLUDED.auth_tag,
    status = 'ACTIVE',
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_organization_twilio_credentials(
  p_organization_id UUID,
  p_updated_by UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  PERFORM 1 FROM public.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_updated_by AND p.organization_id = p_organization_id
     AND p.role = 'OWNER' AND p.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_owner_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.calls c
     WHERE c.organization_id = p_organization_id
       AND c.status IN ('INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS')
  ) THEN
    RETURN FALSE;
  END IF;
  UPDATE public.organization_twilio_credentials
     SET status = 'REVOKED', updated_by = p_updated_by,
         updated_at = pg_catalog.clock_timestamp()
   WHERE organization_id = p_organization_id AND status = 'ACTIVE';
  RETURN TRUE;
END;
$function$;

CREATE INDEX leads_org_phone_inbound_idx
  ON public.leads(organization_id, phone);

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.calls
     WHERE provider = 'TWILIO' AND provider_call_id IS NOT NULL
     GROUP BY provider_call_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create unique Twilio SID index: duplicate provider_call_id values exist';
  END IF;
END;
$preflight$;

CREATE UNIQUE INDEX calls_twilio_provider_call_id_uidx
  ON public.calls(provider_call_id)
  WHERE provider = 'TWILIO' AND provider_call_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prepare_twilio_outbound_call(
  p_organization_id UUID,
  p_telecaller_id UUID,
  p_lead_id UUID,
  p_idempotency_key UUID,
  p_twilio_config_updated_at TIMESTAMPTZ
) RETURNS TABLE(call_id UUID, call_status TEXT, reused BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing public.call_bridges%ROWTYPE;
  v_call_id UUID := extensions.uuid_generate_v4();
  v_config_updated_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_telecaller_id IS NULL OR p_lead_id IS NULL
     OR p_idempotency_key IS NULL OR p_twilio_config_updated_at IS NULL THEN
    RAISE EXCEPTION 'invalid_call_request' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '42501';
  END IF;
  SELECT t.updated_at INTO v_config_updated_at
    FROM public.organization_twilio_credentials t
   WHERE t.organization_id = p_organization_id AND t.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND OR v_config_updated_at IS DISTINCT FROM p_twilio_config_updated_at THEN
    RAISE EXCEPTION 'twilio_configuration_changed' USING ERRCODE = '40001';
  END IF;

  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_telecaller_id
     AND p.organization_id = p_organization_id
     AND p.role = 'TELECALLER'
     AND p.status = 'ACTIVE'
     AND p.phone_verified IS TRUE
     AND p.phone ~ '^\+[1-9][0-9]{7,14}$'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'caller_not_authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.leads l
   WHERE l.id = p_lead_id
     AND l.organization_id = p_organization_id
     AND l.assigned_to = p_telecaller_id
     AND l.status <> 'DO_NOT_CONTACT'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_assigned_or_not_callable' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::TEXT || ':' || p_telecaller_id::TEXT || ':' || p_idempotency_key::TEXT,
      0
    )
  );

  SELECT b.* INTO v_existing FROM public.call_bridges b
   WHERE b.organization_id = p_organization_id
     AND b.telecaller_id = p_telecaller_id
     AND b.idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.calls c
       WHERE c.id = v_existing.call_id AND c.lead_id = p_lead_id
         AND c.organization_id = p_organization_id
         AND c.telecaller_id = p_telecaller_id
    ) THEN
      RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.call_id,
      (SELECT c.status::TEXT FROM public.calls c WHERE c.id = v_existing.call_id), TRUE;
    RETURN;
  END IF;

  INSERT INTO public.calls (
    id, organization_id, lead_id, telecaller_id, provider, provider_call_id,
    started_at, duration_seconds, status, recording_consent
  ) VALUES (
    v_call_id, p_organization_id, p_lead_id, p_telecaller_id, 'TWILIO', NULL,
    pg_catalog.clock_timestamp(), 0, 'INITIATED', FALSE
  );

  INSERT INTO public.call_bridges (
    call_id, organization_id, telecaller_id, idempotency_key, status,
    caller_leg_state, customer_leg_state
  ) VALUES (
    v_call_id, p_organization_id, p_telecaller_id, p_idempotency_key,
    'PREPARING', 'PENDING', 'PENDING'
  );

  UPDATE public.leads l SET status = 'CONTACTED', updated_at = pg_catalog.clock_timestamp()
   WHERE l.id = p_lead_id AND l.organization_id = p_organization_id
     AND l.assigned_to = p_telecaller_id AND l.status IN ('NEW', 'ASSIGNED');
  INSERT INTO public.activity_logs (
    organization_id, user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    p_organization_id, p_telecaller_id, 'CALL_STARTED', 'call', v_call_id,
    pg_catalog.jsonb_build_object('leadId', p_lead_id, 'provider', 'TWILIO', 'status', 'INITIATED')
  );

  RETURN QUERY SELECT v_call_id, 'INITIATED'::TEXT, FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_twilio_customer_leg(p_call_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  UPDATE public.call_bridges b
     SET customer_leg_state = 'CREATING',
         status = 'CALLER_CONNECTED',
         caller_leg_state = 'IN_PROGRESS',
         caller_leg_answered_at = COALESCE(b.caller_leg_answered_at, pg_catalog.clock_timestamp()),
         updated_at = pg_catalog.clock_timestamp()
   WHERE b.call_id = p_call_id
     AND b.flow = 'OUTBOUND'
     AND b.status IN ('PREPARING', 'WAITING_FOR_CALLER', 'CALLER_CONNECTED')
     AND b.customer_leg_state = 'PENDING'
     AND b.caller_leg_state IN ('QUEUED', 'RINGING', 'IN_PROGRESS')
     AND b.customer_provider_call_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.calls c
        WHERE c.id = b.call_id
          AND c.organization_id = b.organization_id
          AND c.status IN ('INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS')
     );
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attach_twilio_leg_sid(
  p_call_id UUID,
  p_leg TEXT,
  p_call_sid TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_updated BOOLEAN := FALSE;
  v_flow TEXT;
BEGIN
  IF p_leg NOT IN ('caller', 'customer')
     OR p_call_sid !~ '^CA[0-9A-Fa-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_twilio_leg_reference' USING ERRCODE = '22023';
  END IF;

  IF p_leg = 'caller' THEN
    UPDATE public.call_bridges b
       SET caller_provider_call_id = p_call_sid,
           caller_leg_state = CASE WHEN b.caller_leg_state = 'PENDING' THEN 'QUEUED' ELSE b.caller_leg_state END,
           status = CASE WHEN b.status = 'PREPARING' THEN 'WAITING_FOR_CALLER' ELSE b.status END,
           caller_leg_created_at = COALESCE(b.caller_leg_created_at, pg_catalog.clock_timestamp()),
           updated_at = pg_catalog.clock_timestamp()
     WHERE b.call_id = p_call_id
       AND (b.caller_provider_call_id IS NULL OR b.caller_provider_call_id = p_call_sid);
    v_updated := FOUND;
  ELSE
    UPDATE public.call_bridges b
       SET customer_provider_call_id = p_call_sid,
           customer_leg_state = CASE
             WHEN b.customer_leg_state = 'CREATING' OR (b.flow = 'INBOUND' AND b.customer_leg_state = 'PENDING')
               THEN 'QUEUED'
             ELSE b.customer_leg_state
           END,
           customer_leg_created_at = COALESCE(b.customer_leg_created_at, pg_catalog.clock_timestamp()),
           updated_at = pg_catalog.clock_timestamp()
     WHERE b.call_id = p_call_id
       AND (b.customer_leg_state IN ('CREATING', 'QUEUED', 'RINGING', 'IN_PROGRESS')
            OR (b.flow = 'INBOUND' AND b.customer_leg_state = 'PENDING'))
       AND (b.customer_provider_call_id IS NULL OR b.customer_provider_call_id = p_call_sid)
    RETURNING b.flow INTO v_flow;
    v_updated := FOUND;
    -- Outbound uses the customer leg as the canonical call SID. Inbound keeps
    -- the original parent call SID and stores the dialed telecaller SID only
    -- on the bridge row.
    IF v_updated AND v_flow = 'OUTBOUND' THEN
      UPDATE public.calls c SET provider_call_id = p_call_sid
       WHERE c.id = p_call_id AND c.provider = 'TWILIO'
         AND (c.provider_call_id IS NULL OR c.provider_call_id = p_call_sid);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'twilio_call_sid_conflict' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;
  RETURN v_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_twilio_inbound_attempt(
  p_organization_id UUID,
  p_call_sid TEXT,
  p_outcome TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_call_sid !~ '^CA[0-9A-Fa-f]{32}$'
     OR p_outcome NOT IN (
       'UNMATCHED_OR_AMBIGUOUS_NUMBER', 'NO_MATCHING_LEAD', 'AMBIGUOUS_LEAD',
       'NO_ELIGIBLE_TELECALLER', 'ROUTED', 'CALLER_UNAVAILABLE', 'PROVIDER_ERROR'
     ) THEN
    RAISE EXCEPTION 'invalid_inbound_call_attempt' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.telephony_inbound_attempts(organization_id, provider_call_sid, outcome)
  VALUES (p_organization_id, p_call_sid, p_outcome)
  ON CONFLICT (provider_call_sid) DO NOTHING;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_twilio_inbound_call(
  p_organization_id UUID,
  p_call_sid TEXT,
  p_from_phone TEXT,
  p_twilio_phone_number TEXT,
  p_twilio_config_updated_at TIMESTAMPTZ
) RETURNS TABLE(outcome TEXT, call_id UUID, telecaller_phone TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_call_id UUID;
  v_match_count INTEGER;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_config_updated_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_call_sid !~ '^CA[0-9A-Fa-f]{32}$'
     OR p_from_phone !~ '^\+[1-9][0-9]{7,14}$'
     OR p_twilio_phone_number !~ '^\+[1-9][0-9]{7,14}$'
     OR p_twilio_config_updated_at IS NULL THEN
    RAISE EXCEPTION 'invalid_inbound_call' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '42501';
  END IF;
  SELECT t.updated_at INTO v_config_updated_at
    FROM public.organization_twilio_credentials t
   WHERE t.organization_id = p_organization_id
     AND t.twilio_phone_number = p_twilio_phone_number
     AND t.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND OR v_config_updated_at IS DISTINCT FROM p_twilio_config_updated_at THEN
    RAISE EXCEPTION 'twilio_configuration_changed' USING ERRCODE = '40001';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_call_sid, 0));

  SELECT c.id INTO v_call_id FROM public.calls c
   WHERE c.organization_id = p_organization_id
     AND c.provider = 'TWILIO' AND c.provider_call_id = p_call_sid;
  IF FOUND THEN
    SELECT p.* INTO v_profile
      FROM public.calls c JOIN public.profiles p ON p.id = c.telecaller_id
      JOIN public.leads l ON l.id = c.lead_id
        AND l.organization_id = c.organization_id AND l.assigned_to = c.telecaller_id
     WHERE c.id = v_call_id AND c.organization_id = p_organization_id
       AND p.organization_id = p_organization_id AND p.role = 'TELECALLER'
       AND p.status = 'ACTIVE' AND p.phone_verified IS TRUE
       AND p.phone ~ '^\+[1-9][0-9]{7,14}$'
       AND l.status <> 'DO_NOT_CONTACT';
    IF NOT FOUND THEN
      INSERT INTO public.telephony_inbound_attempts(organization_id, provider_call_sid, outcome)
        VALUES (p_organization_id, p_call_sid, 'CALLER_UNAVAILABLE') ON CONFLICT DO NOTHING;
      RETURN QUERY SELECT 'CALLER_UNAVAILABLE'::TEXT, NULL::UUID, NULL::TEXT;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'REUSED'::TEXT, v_call_id, v_profile.phone;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::INTEGER INTO v_match_count
    FROM public.leads l
   WHERE l.organization_id = p_organization_id AND l.phone = p_from_phone;
  IF v_match_count = 0 THEN
    INSERT INTO public.telephony_inbound_attempts(organization_id, provider_call_sid, outcome)
      VALUES (p_organization_id, p_call_sid, 'NO_MATCHING_LEAD') ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT 'NO_MATCHING_LEAD'::TEXT, NULL::UUID, NULL::TEXT;
    RETURN;
  ELSIF v_match_count > 1 THEN
    INSERT INTO public.telephony_inbound_attempts(organization_id, provider_call_sid, outcome)
      VALUES (p_organization_id, p_call_sid, 'AMBIGUOUS_LEAD') ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT 'AMBIGUOUS_LEAD'::TEXT, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  SELECT l.* INTO v_lead FROM public.leads l
   WHERE l.organization_id = p_organization_id AND l.phone = p_from_phone
   LIMIT 1 FOR UPDATE;
  IF v_lead.assigned_to IS NULL OR v_lead.status = 'DO_NOT_CONTACT' THEN
    INSERT INTO public.telephony_inbound_attempts(organization_id, provider_call_sid, outcome)
      VALUES (p_organization_id, p_call_sid, 'NO_ELIGIBLE_TELECALLER') ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT 'NO_ELIGIBLE_TELECALLER'::TEXT, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  SELECT p.* INTO v_profile FROM public.profiles p
   WHERE p.id = v_lead.assigned_to AND p.organization_id = p_organization_id
     AND p.role = 'TELECALLER' AND p.status = 'ACTIVE'
     AND p.phone_verified IS TRUE AND p.phone ~ '^\+[1-9][0-9]{7,14}$'
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.telephony_inbound_attempts(organization_id, provider_call_sid, outcome)
      VALUES (p_organization_id, p_call_sid, 'NO_ELIGIBLE_TELECALLER') ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT 'NO_ELIGIBLE_TELECALLER'::TEXT, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  v_call_id := extensions.uuid_generate_v4();
  INSERT INTO public.calls(
    id, organization_id, lead_id, telecaller_id, provider, provider_call_id,
    started_at, duration_seconds, status, recording_consent
  ) VALUES (
    v_call_id, p_organization_id, v_lead.id, v_profile.id, 'TWILIO', p_call_sid,
    v_now, 0, 'RINGING', FALSE
  );
  INSERT INTO public.call_bridges(
    call_id, organization_id, telecaller_id, idempotency_key, conference_id,
    status, caller_provider_call_id, caller_leg_state, customer_leg_state, flow
  ) VALUES (
    v_call_id, p_organization_id, v_profile.id, extensions.uuid_generate_v4(),
    extensions.uuid_generate_v4(), 'WAITING_FOR_CALLER', p_call_sid,
    'IN_PROGRESS', 'PENDING', 'INBOUND'
  );
  INSERT INTO public.telephony_inbound_attempts(organization_id, provider_call_sid, outcome)
    VALUES (p_organization_id, p_call_sid, 'ROUTED') ON CONFLICT DO NOTHING;
  INSERT INTO public.activity_logs(organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_organization_id, v_profile.id, 'INCOMING_CALL_ROUTED', 'call', v_call_id,
    pg_catalog.jsonb_build_object('leadId', v_lead.id, 'provider', 'TWILIO', 'status', 'RINGING')
  );
  RETURN QUERY SELECT 'ROUTED'::TEXT, v_call_id, v_profile.phone;
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_twilio_outbound_call(UUID, UUID, UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_twilio_customer_leg(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_twilio_leg_sid(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_twilio_inbound_attempt(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_twilio_inbound_call(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_organization_twilio_credentials(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_organization_twilio_credentials(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_twilio_outbound_call(UUID, UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_twilio_customer_leg(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_twilio_leg_sid(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_twilio_inbound_attempt(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_twilio_inbound_call(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_organization_twilio_credentials(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_organization_twilio_credentials(UUID, UUID) TO service_role;

COMMIT;
