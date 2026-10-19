-- ENCRIX Phase 14: Production Telephony, Webhook Idempotency, and Storage Hardening
-- Migration: 20261006000000_production_telephony_recordings.sql

-- 1. Webhook Events Table for Idempotency and Replay Attack Prevention
CREATE TABLE IF NOT EXISTS public.webhook_events (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    provider VARCHAR(50) NOT NULL DEFAULT 'TWILIO',
    provider_event_id VARCHAR(150) NOT NULL UNIQUE,
    call_sid VARCHAR(150),
    event_type VARCHAR(50),
    payload JSONB,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on webhook_events
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Restrict webhook_events strictly to backend service_role
CREATE POLICY "Service role full access on webhook_events"
    ON public.webhook_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 2. Extend calls table status CHECK constraint to support production Twilio statuses
ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_status_check CHECK (
    status IN (
        'INITIATED',
        'RINGING',
        'CONNECTED',
        'IN_PROGRESS',
        'COMPLETED',
        'MISSED',
        'NO_ANSWER',
        'BUSY',
        'CANCELED',
        'FAILED'
    )
);

-- 3. Storage setup is managed through Supabase Storage, not SQL migrations.
-- Create the private call-recordings bucket and its scoped policies through the
-- Supabase Dashboard or Storage API after this migration has been applied.

-- 4. Authorized Call Recording Access Verification Function
-- Strict initiator-only telecaller verification. Accepts p_user_id for internal service_role callers.
CREATE OR REPLACE FUNCTION public.can_access_call_recording(p_call_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role VARCHAR(20);
    v_user_org UUID;
    v_user_profile_id UUID;
    v_user_status VARCHAR(20);
    v_call_org UUID;
    v_call_telecaller UUID;
BEGIN
    -- Look up requesting user profile
    SELECT role, organization_id, id, status
    INTO v_user_role, v_user_org, v_user_profile_id, v_user_status
    FROM public.profiles
    WHERE user_id = p_user_id;

    IF v_user_profile_id IS NULL OR v_user_status != 'ACTIVE' THEN
        RETURN FALSE;
    END IF;

    -- Platform admins have access across all organizations
    IF v_user_role = 'ADMIN' THEN
        RETURN TRUE;
    END IF;

    -- Look up call metadata
    SELECT c.organization_id, c.telecaller_id
    INTO v_call_org, v_call_telecaller
    FROM public.calls c
    WHERE c.id = p_call_id;

    IF v_call_org IS NULL OR v_call_org != v_user_org THEN
        RETURN FALSE;
    END IF;

    -- Owners can access all recordings within their organization
    IF v_user_role = 'OWNER' THEN
        RETURN TRUE;
    END IF;

    -- Telecallers can only access calls they personally initiated (initiator-only)
    IF v_user_role = 'TELECALLER' THEN
        IF v_call_telecaller = v_user_profile_id THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;

-- Restrict the 2-argument variant strictly to service_role to prevent caller user ID spoofing
REVOKE ALL ON FUNCTION public.can_access_call_recording(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_call_recording(UUID, UUID) TO service_role;

-- 5. Safe Client-Facing Recording Authorization (Derives Identity Strictly from auth.uid())
CREATE OR REPLACE FUNCTION public.can_access_call_recording(p_call_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN public.can_access_call_recording(p_call_id, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_call_recording(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_call_recording(UUID) TO authenticated, service_role;

-- 6. Safe Path-Based Recording Authorization for Storage Policies
-- Validates canonical path {organization_id}/{call_id}.mp3 and delegates authorization
CREATE OR REPLACE FUNCTION public.can_access_call_recording_path(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_parts TEXT[];
    v_org_str TEXT;
    v_call_str TEXT;
    v_org_id UUID;
    v_call_id UUID;
    v_call_org UUID;
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN TRUE;
    END IF;

    IF auth.uid() IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Strict regex validation: exactly {uuid}/{uuid}.mp3 with no traversal, extra segments, or extensions
    IF p_path IS NULL OR NOT (p_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$') THEN
        RETURN FALSE;
    END IF;

    v_parts := string_to_array(p_path, '/');
    IF array_length(v_parts, 1) != 2 THEN
        RETURN FALSE;
    END IF;

    v_org_str := v_parts[1];
    v_call_str := substring(v_parts[2] from 1 for 36);

    -- Safe UUID cast inside procedural exception block
    BEGIN
        v_org_id := v_org_str::UUID;
        v_call_id := v_call_str::UUID;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
    END;

    -- Verify path organization matches call's actual recorded organization
    SELECT organization_id INTO v_call_org
    FROM public.calls
    WHERE id = v_call_id;

    IF v_call_org IS NULL OR v_call_org != v_org_id THEN
        RETURN FALSE;
    END IF;

    -- Delegate access decision strictly to public.can_access_call_recording(UUID)
    RETURN public.can_access_call_recording(v_call_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_call_recording_path(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_call_recording_path(TEXT) TO authenticated, service_role;


