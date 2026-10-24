-- ENCRIX Phase 4: verified caller enrollment and service-only bridge records.
-- Depends on 20261007000000 (profiles.phone_verified) and 20261006000000
-- (calls and webhook_events). Run only after the complete prior chain.

-- Enrollment OTPs are tied to one active telecaller profile and are never
-- readable by browser roles. phone_number is retained only while pending and
-- cleared by the completion/cancellation functions.
-- The profiles primary key covers id alone; this composite key is required
-- by the tenant-consistent foreign keys below.
CREATE UNIQUE INDEX profiles_id_organization_unique_idx
    ON public.profiles(id, organization_id);

CREATE TABLE public.caller_phone_enrollments (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL,
    phone_number TEXT,
    otp_hash VARCHAR(64) NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resend_after TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT caller_phone_enrollments_profile_org_fkey
        FOREIGN KEY (profile_id, organization_id)
        REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT caller_phone_enrollments_phone_format_check
        CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT caller_phone_enrollments_expiry_check
        CHECK (expires_at > created_at)
);

CREATE INDEX caller_phone_enrollments_profile_created_idx
    ON public.caller_phone_enrollments(profile_id, created_at DESC);
CREATE UNIQUE INDEX caller_phone_enrollments_one_pending_per_profile_idx
    ON public.caller_phone_enrollments(profile_id) WHERE consumed_at IS NULL;

ALTER TABLE public.caller_phone_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.caller_phone_enrollments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.caller_phone_enrollments TO service_role;
CREATE POLICY caller_phone_enrollments_service_role_only
    ON public.caller_phone_enrollments FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Serialize send attempts on the profile row so cooldown and per-window
-- limits cannot be bypassed by concurrent requests.
CREATE OR REPLACE FUNCTION public.begin_caller_phone_enrollment(
    p_profile_id UUID,
    p_organization_id UUID,
    p_phone_number TEXT,
    p_otp_hash TEXT
)
RETURNS TABLE(outcome TEXT, enrollment_id UUID, resend_after TIMESTAMPTZ, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
    v_pending public.caller_phone_enrollments%ROWTYPE;
    v_send_count INTEGER;
    v_id UUID;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_phone_number IS NULL OR p_phone_number !~ '^\+[1-9][0-9]{7,14}$'
       OR p_otp_hash IS NULL OR p_otp_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN QUERY SELECT 'INVALID_INPUT'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = p_profile_id
      AND organization_id = p_organization_id
      AND role = 'TELECALLER'
      AND status = 'ACTIVE'
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_AUTHORIZED'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    IF v_profile.phone_verified AND v_profile.phone = p_phone_number THEN
        RETURN QUERY SELECT 'ALREADY_VERIFIED'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    SELECT COUNT(*) INTO v_send_count
    FROM public.caller_phone_enrollments e
    WHERE e.profile_id = p_profile_id
      AND e.created_at > v_now - INTERVAL '15 minutes';
    IF v_send_count >= 5 THEN
        RETURN QUERY SELECT 'RATE_LIMITED'::TEXT, NULL::UUID, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    SELECT * INTO v_pending
    FROM public.caller_phone_enrollments e
    WHERE e.profile_id = p_profile_id AND e.consumed_at IS NULL
    ORDER BY e.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND v_pending.expires_at > v_now AND v_pending.resend_after > v_now THEN
        RETURN QUERY SELECT 'COOLDOWN'::TEXT, v_pending.id, v_pending.resend_after, v_pending.expires_at;
        RETURN;
    END IF;

    IF FOUND THEN
        UPDATE public.caller_phone_enrollments
        SET consumed_at = v_now, phone_number = NULL
        WHERE id = v_pending.id;
    END IF;

    v_id := extensions.uuid_generate_v4();
    INSERT INTO public.caller_phone_enrollments(
        id, organization_id, profile_id, phone_number, otp_hash,
        attempts, created_at, resend_after, expires_at
    ) VALUES (
        v_id, p_organization_id, p_profile_id, p_phone_number, p_otp_hash,
        0, v_now, v_now + INTERVAL '60 seconds', v_now + INTERVAL '5 minutes'
    );

    RETURN QUERY SELECT 'CREATED'::TEXT, v_id, v_now + INTERVAL '60 seconds', v_now + INTERVAL '5 minutes';
END;
$$;

-- Consume or count an attempt atomically. On success this is the only path
-- that changes profiles.phone and profiles.phone_verified.
CREATE OR REPLACE FUNCTION public.complete_caller_phone_enrollment(
    p_enrollment_id UUID,
    p_profile_id UUID,
    p_code_matches BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enrollment public.caller_phone_enrollments%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_enrollment
    FROM public.caller_phone_enrollments
    WHERE id = p_enrollment_id AND profile_id = p_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF v_enrollment.consumed_at IS NOT NULL THEN RETURN 'REPLAYED'; END IF;
    IF v_enrollment.expires_at <= v_now THEN
        UPDATE public.caller_phone_enrollments
        SET consumed_at = v_now, phone_number = NULL
        WHERE id = v_enrollment.id;
        RETURN 'EXPIRED';
    END IF;
    IF v_enrollment.attempts >= 5 THEN
        UPDATE public.caller_phone_enrollments
        SET consumed_at = v_now, phone_number = NULL
        WHERE id = v_enrollment.id;
        RETURN 'MAX_ATTEMPTS';
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = p_profile_id
      AND organization_id = v_enrollment.organization_id
      AND role = 'TELECALLER'
      AND status = 'ACTIVE'
    FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_AUTHORIZED'; END IF;

    IF p_code_matches IS DISTINCT FROM TRUE THEN
        UPDATE public.caller_phone_enrollments
        SET attempts = attempts + 1,
            consumed_at = CASE WHEN attempts + 1 >= 5 THEN v_now ELSE NULL END,
            phone_number = CASE WHEN attempts + 1 >= 5 THEN NULL ELSE phone_number END
        WHERE id = v_enrollment.id;
        IF v_enrollment.attempts + 1 >= 5 THEN RETURN 'MAX_ATTEMPTS'; END IF;
        RETURN 'INVALID';
    END IF;

    IF v_enrollment.phone_number IS NULL THEN RETURN 'NOT_FOUND'; END IF;
    UPDATE public.profiles
    SET phone = v_enrollment.phone_number,
        phone_verified = TRUE,
        updated_at = v_now
    WHERE id = v_profile.id;
    UPDATE public.caller_phone_enrollments
    SET consumed_at = v_now, phone_number = NULL
    WHERE id = v_enrollment.id;
    RETURN 'VERIFIED';
END;
$$;

REVOKE ALL ON FUNCTION public.begin_caller_phone_enrollment(UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_caller_phone_enrollment(UUID, UUID, TEXT, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.complete_caller_phone_enrollment(UUID, UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_caller_phone_enrollment(UUID, UUID, BOOLEAN)
    TO service_role;

-- Profiles are user-readable, so browser clients must not be able to self-assert
-- ownership by changing either the number or its verification state.
CREATE OR REPLACE FUNCTION public.prevent_profile_phone_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND (
        NEW.phone IS DISTINCT FROM OLD.phone OR
        NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
    ) THEN
        RAISE EXCEPTION 'Phone number changes require server-side verification.';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_profile_phone_self_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_prevent_profile_phone_self_update ON public.profiles;
CREATE TRIGGER trg_prevent_profile_phone_self_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_phone_self_update();

-- Bridge identifiers and leg state are never exposed through browser roles.
-- Phone numbers and Twilio credentials are intentionally absent from this table.
CREATE UNIQUE INDEX calls_id_organization_telecaller_unique_idx
    ON public.calls(id, organization_id, telecaller_id);

CREATE TABLE public.call_bridges (
    call_id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    telecaller_id UUID NOT NULL,
    idempotency_key UUID NOT NULL,
    conference_id UUID NOT NULL UNIQUE DEFAULT extensions.uuid_generate_v4(),
    status TEXT NOT NULL DEFAULT 'PREPARING'
        CHECK (status IN ('PREPARING', 'WAITING_FOR_CALLER', 'CALLER_CONNECTED', 'BRIDGED', 'ENDING', 'COMPLETED', 'FAILED', 'RECOVERY_REQUIRED')),
    caller_provider_call_id VARCHAR(34) UNIQUE,
    caller_leg_state TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (caller_leg_state IN ('PENDING', 'QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'CANCELED', 'FAILED')),
    caller_leg_created_at TIMESTAMPTZ,
    caller_leg_answered_at TIMESTAMPTZ,
    caller_leg_ended_at TIMESTAMPTZ,
    customer_provider_call_id VARCHAR(34) UNIQUE,
    customer_leg_state TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (customer_leg_state IN ('PENDING', 'QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'CANCELED', 'FAILED')),
    customer_leg_created_at TIMESTAMPTZ,
    customer_leg_answered_at TIMESTAMPTZ,
    customer_leg_ended_at TIMESTAMPTZ,
    recovery_required BOOLEAN NOT NULL DEFAULT FALSE,
    failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN (
        'CALLER_LEG_CREATE_FAILED', 'CALLER_LEG_NOT_ANSWERED',
        'CUSTOMER_LEG_CREATE_FAILED', 'CUSTOMER_LEG_NOT_ANSWERED',
        'CALL_STATE_PERSISTENCE_FAILED', 'CALLBACK_STATE_CONFLICT'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT call_bridges_calls_org_fkey
        FOREIGN KEY (call_id, organization_id, telecaller_id)
        REFERENCES public.calls(id, organization_id, telecaller_id) ON DELETE CASCADE,
    CONSTRAINT call_bridges_telecaller_org_fkey
        FOREIGN KEY (telecaller_id, organization_id)
        REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE,
    CONSTRAINT call_bridges_telecaller_idempotency_key
        UNIQUE (organization_id, telecaller_id, idempotency_key),
    CONSTRAINT call_bridges_caller_sid_format_check
        CHECK (caller_provider_call_id IS NULL OR caller_provider_call_id ~ '^CA[0-9a-fA-F]{32}$'),
    CONSTRAINT call_bridges_customer_sid_format_check
        CHECK (customer_provider_call_id IS NULL OR customer_provider_call_id ~ '^CA[0-9a-fA-F]{32}$')
);

CREATE INDEX call_bridges_org_created_idx ON public.call_bridges(organization_id, created_at DESC);
CREATE INDEX webhook_events_call_sid_idx
    ON public.webhook_events(call_sid) WHERE call_sid IS NOT NULL;

ALTER TABLE public.call_bridges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_bridges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.call_bridges TO service_role;
CREATE POLICY call_bridges_service_role_only
    ON public.call_bridges FOR ALL TO service_role
    USING (true) WITH CHECK (true);
