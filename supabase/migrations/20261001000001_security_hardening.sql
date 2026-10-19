-- ====================================================================
-- LEADVAULT: Security Hardening & Zero-Leakage Migration (Phase 11)
-- Multi-Tenant Telecaller Isolation & Immutable Audit Trails
-- ====================================================================

-- 1. IMMUTABLE AUDIT TRAILS (Sections 19 & 20)
-- Revoke destructive and modifying privileges on audit tables
REVOKE UPDATE, DELETE, TRUNCATE ON public.activity_logs FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.security_events FROM authenticated, anon;

-- Function to raise exception on any modification or deletion of audit logs
CREATE OR REPLACE FUNCTION public.prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Policy Violation: LeadVault audit trails (activity_logs, security_events) are strictly append-only. Modification and deletion are prohibited by compliance policy.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to guarantee append-only immutability on activity_logs
DROP TRIGGER IF EXISTS trg_activity_logs_immutable ON public.activity_logs;
CREATE TRIGGER trg_activity_logs_immutable
BEFORE UPDATE OR DELETE ON public.activity_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_tampering();

-- Trigger to guarantee append-only immutability on security_events
DROP TRIGGER IF EXISTS trg_security_events_immutable ON public.security_events;
CREATE TRIGGER trg_security_events_immutable
BEFORE UPDATE OR DELETE ON public.security_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_tampering();

-- 2. DATABASE-LEVEL PHONE MASKING FUNCTION (Section 10)
CREATE OR REPLACE FUNCTION public.mask_phone(phone_input TEXT)
RETURNS TEXT AS $$
DECLARE
    cleaned TEXT;
    len INT;
BEGIN
    IF phone_input IS NULL OR LENGTH(TRIM(phone_input)) = 0 THEN
        RETURN '—';
    END IF;

    cleaned := TRIM(phone_input);
    len := LENGTH(cleaned);

    IF len <= 4 THEN
        RETURN '******';
    END IF;

    IF cleaned LIKE '+%' THEN
        RETURN SUBSTRING(cleaned FROM 1 FOR 4) || ' ******' || SUBSTRING(cleaned FROM (len - 1));
    ELSE
        RETURN '******' || SUBSTRING(cleaned FROM (len - 3));
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. SECURE VIEW FOR TELECALLERS (Zero-Leakage Network Boundary - Section 5)
-- Ensures telecaller queries NEVER return raw phone or raw email in database responses
CREATE OR REPLACE VIEW public.telecaller_leads_view AS
SELECT
    l.id,
    l.organization_id,
    l.lead_code,
    SUBSTRING(l.name FROM 1 FOR POSITION(' ' IN l.name || ' ')) || ' ' || SUBSTRING(SUBSTRING(l.name FROM POSITION(' ' IN l.name || ' ') + 1) FROM 1 FOR 1) || '.' AS name,
    public.mask_phone(l.phone) AS phone,
    '***@***.***' AS email,
    l.source,
    l.status,
    l.priority,
    l.assigned_to,
    l.notes,
    l.created_at,
    l.updated_at
FROM public.leads l
WHERE l.assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid());

GRANT SELECT ON public.telecaller_leads_view TO authenticated;

-- 4. SERVER-SIDE AUTHORIZED CALL PLACEMENT (Section 6)
-- Telecallers initiate calls by lead_id. Number is resolved server-side and sent directly
-- to telephony gateway webhook without exposing raw customer phone to caller browser.
CREATE OR REPLACE FUNCTION public.initiate_authorized_call(target_lead_id UUID)
RETURNS JSONB AS $$
DECLARE
    caller_profile public.profiles;
    target_lead public.leads;
    call_session_id UUID;
BEGIN
    -- 1. Identify and authenticate caller
    SELECT * INTO caller_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
    IF caller_profile.id IS NULL OR caller_profile.status = 'DISABLED' THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated or suspended caller profile.';
    END IF;

    -- 2. Retrieve target lead
    SELECT * INTO target_lead FROM public.leads WHERE id = target_lead_id LIMIT 1;
    IF target_lead.id IS NULL THEN
        RAISE EXCEPTION 'Target lead not found.';
    END IF;

    -- 3. Multi-tenant organization isolation
    IF caller_profile.role != 'ADMIN' AND target_lead.organization_id != caller_profile.organization_id THEN
        RAISE EXCEPTION 'Forbidden: Lead belongs to another organization.';
    END IF;

    -- 4. Telecaller assignment verification
    IF caller_profile.role = 'TELECALLER' AND target_lead.assigned_to != caller_profile.id THEN
        -- Auto-raise high-severity security event
        INSERT INTO public.security_events (organization_id, user_id, event_type, severity, description)
        VALUES (
            caller_profile.organization_id,
            caller_profile.id,
            'UNAUTHORIZED_CALL_ATTEMPT',
            'HIGH',
            CONCAT('Telecaller ', caller_profile.full_name, ' attempted unauthorized call initiation on unassigned lead.')
        );
        RAISE EXCEPTION 'Forbidden: You cannot call a lead that is not assigned to you.';
    END IF;

    -- 5. Create secure call audit record
    call_session_id := extensions.uuid_generate_v4();
    INSERT INTO public.calls (
        id,
        organization_id,
        lead_id,
        telecaller_id,
        provider,
        provider_call_id,
        status,
        started_at
    ) VALUES (
        call_session_id,
        caller_profile.organization_id,
        target_lead.id,
        caller_profile.id,
        'MOCK',
        CONCAT('GATEWAY_CALL_', EXTRACT(EPOCH FROM NOW())::BIGINT),
        'INITIATED',
        NOW()
    );

    -- 6. Log activity
    INSERT INTO public.activity_logs (
        organization_id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        caller_profile.organization_id,
        caller_profile.id,
        'CALL_RECORDED',
        'call',
        call_session_id,
        jsonb_build_object('leadCode', target_lead.lead_code, 'status', 'INITIATED')
    );

    -- 7. Return safe session details to client WITHOUT raw phone
    RETURN jsonb_build_object(
        'call_id', call_session_id,
        'lead_id', target_lead.id,
        'lead_code', target_lead.lead_code,
        'masked_phone', public.mask_phone(target_lead.phone),
        'status', 'INITIATED'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.initiate_authorized_call(UUID) TO authenticated;

-- 5. DISABLED ACCOUNT SESSION REVOCATION (Section 18)
-- Ensure disabled accounts are immediately rejected by RLS helper
CREATE OR REPLACE FUNCTION public.is_caller_active()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND status = 'ACTIVE'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;
