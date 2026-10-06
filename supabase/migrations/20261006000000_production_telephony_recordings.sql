-- ENCRIX Phase 14: Production Telephony, Webhook Idempotency, and Storage Hardening
-- Migration: 20261006000000_production_telephony_recordings.sql

-- 1. Webhook Events Table for Idempotency and Replay Attack Prevention
CREATE TABLE IF NOT EXISTS public.webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 3. Storage Hardening: Private Call Recordings Bucket
-- Insert private bucket if storage schema exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'call-recordings',
    'call-recordings',
    false,
    52428800, -- 50MB per recording max
    ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 52428800;

-- Ensure RLS is active on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Storage Policy: Deny public/anon access completely
CREATE POLICY "Deny anon access to call-recordings"
    ON storage.objects
    FOR ALL
    TO anon
    USING (false);

-- Storage Policy: Organization-scoped read access for authenticated tenant members
CREATE POLICY "Tenant members can access own call recordings"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'call-recordings' AND
        EXISTS (
            SELECT 1 FROM public.calls c
            JOIN public.profiles p ON p.organization_id = c.organization_id
            WHERE p.user_id = auth.uid()
            AND p.status = 'ACTIVE'
            AND (
                -- Owners & Admins can access all recordings in their organization
                p.role IN ('ADMIN', 'OWNER')
                OR
                -- Telecallers can only access recordings of calls they initiated or are assigned to
                (p.role = 'TELECALLER' AND (c.telecaller_id = p.id OR EXISTS (
                    SELECT 1 FROM public.leads l
                    WHERE l.id = c.lead_id AND l.assigned_to = p.id
                )))
            )
            -- Matches file path convention: <organization_id>/<call_id>.mp3
            AND storage.objects.name LIKE (c.organization_id::text || '/%')
        )
    );

-- 4. Authorized Call Recording Access Verification Function
CREATE OR REPLACE FUNCTION public.can_access_call_recording(p_call_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_role VARCHAR(20);
    v_user_org UUID;
    v_user_profile_id UUID;
    v_user_status VARCHAR(20);
    v_call_org UUID;
    v_call_telecaller UUID;
    v_lead_assigned UUID;
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
    SELECT c.organization_id, c.telecaller_id, l.assigned_to
    INTO v_call_org, v_call_telecaller, v_lead_assigned
    FROM public.calls c
    LEFT JOIN public.leads l ON l.id = c.lead_id
    WHERE c.id = p_call_id;

    IF v_call_org IS NULL OR v_call_org != v_user_org THEN
        RETURN FALSE;
    END IF;

    -- Owners can access all recordings within their organization
    IF v_user_role = 'OWNER' THEN
        RETURN TRUE;
    END IF;

    -- Telecallers can only access calls they initiated or leads assigned to them
    IF v_user_role = 'TELECALLER' THEN
        IF v_call_telecaller = v_user_profile_id OR v_lead_assigned = v_user_profile_id THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;
