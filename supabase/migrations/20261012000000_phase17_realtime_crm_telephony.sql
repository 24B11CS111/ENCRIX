-- ENCRIX Phase 17: Complete Real-Time Telecalling CRM & Persistence Hardening
-- Migration: 20261012000000_phase17_realtime_crm_telephony.sql

-- 1. Dedicated call_recordings metadata table
CREATE TABLE IF NOT EXISTS public.call_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'TWILIO',
    provider_recording_id VARCHAR(150),
    storage_path TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED', -- PROCESSING, COMPLETED, FAILED, DELETED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on call_recordings
ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;

-- Index for high-volume tenant & call lookup
CREATE INDEX IF NOT EXISTS idx_call_recordings_call_id ON public.call_recordings(call_id);
CREATE INDEX IF NOT EXISTS idx_call_recordings_org_id ON public.call_recordings(organization_id);

-- Storage & Data Isolation Policy on call_recordings
CREATE POLICY "Tenant members can access own call_recordings"
    ON public.call_recordings
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.organization_id = call_recordings.organization_id
            AND p.user_id = auth.uid()
            AND p.status = 'ACTIVE'
            AND (
                p.role IN ('ADMIN', 'OWNER')
                OR (
                    p.role = 'TELECALLER' AND EXISTS (
                        SELECT 1 FROM public.calls c
                        WHERE c.id = call_recordings.call_id
                        AND (c.telecaller_id = p.id OR EXISTS (
                            SELECT 1 FROM public.leads l
                            WHERE l.id = c.lead_id AND l.assigned_to = p.id
                        ))
                    )
                )
            )
        )
    );

-- 2. Performance Indexes for Real-Time CRM Operations
CREATE INDEX IF NOT EXISTS idx_calls_org_status ON public.calls(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_calls_telecaller ON public.calls(telecaller_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_assigned ON public.leads(organization_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_security_events_org_type ON public.security_events(organization_id, event_type);
CREATE INDEX IF NOT EXISTS idx_organization_invitations_token ON public.organization_invitations(token);

-- 3. Trigger for Realtime Publication
-- Ensures calls, leads, follow_ups, and security_events publish full record payloads
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.security_events;
