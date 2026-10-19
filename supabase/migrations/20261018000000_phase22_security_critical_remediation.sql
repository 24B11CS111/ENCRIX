-- ============================================================================
-- ENCRIX Phase 22.3: Security-Critical Schema Remediation & Zero Phone Hardening
-- Migration: 20261018000000_phase22_security_critical_remediation.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MIGRATION DEPENDENCY DEFENSIVE ALIGNMENT & SCHEMA SECURITY
-- ----------------------------------------------------------------------------

-- Ensure public.profiles has email column and index
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Ensure pending_registrations has unique constraint on email for idempotent upserts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pending_registrations_email_key'
    ) THEN
        ALTER TABLE public.pending_registrations
        ADD CONSTRAINT pending_registrations_email_key UNIQUE (email);
    END IF;
END $$;

-- Align public.leads with application model fields (last_contacted_at, calls_count)
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS calls_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_last_contacted
ON public.leads(organization_id, last_contacted_at);

-- Schema Permissions Hardening: Prevent untrusted roles from creating objects in public schema
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM anon;

-- ----------------------------------------------------------------------------
-- 2. PRIVILEGE PROTECTION & ROLE ESCALATION DEFENSE (public.profiles)
-- ----------------------------------------------------------------------------

-- Function to prevent unauthorized modification of role, organization, or status
CREATE OR REPLACE FUNCTION public.protect_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    caller_role VARCHAR;
BEGIN
    -- If executed in the context of an authenticated Supabase user session
    IF auth.uid() IS NOT NULL THEN
        SELECT role INTO caller_role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

        -- Guard 1: Non-admins cannot alter organization_id
        IF NEW.organization_id IS DISTINCT FROM OLD.organization_id AND COALESCE(caller_role, '') != 'ADMIN' THEN
            RAISE EXCEPTION 'Privilege Violation: Changing organization_id is strictly restricted to system administrators.';
        END IF;

        -- Guard 2: Users cannot elevate their own role
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            IF OLD.user_id = auth.uid() THEN
                RAISE EXCEPTION 'Privilege Violation: Self-elevation of user role is strictly prohibited.';
            END IF;
            IF COALESCE(caller_role, '') NOT IN ('ADMIN', 'OWNER') THEN
                RAISE EXCEPTION 'Privilege Violation: Only Owners and Admins can modify user roles.';
            END IF;
            -- Telecallers cannot be promoted to OWNER or ADMIN by non-admins
            IF OLD.role = 'TELECALLER' AND NEW.role IN ('OWNER', 'ADMIN') AND COALESCE(caller_role, '') != 'ADMIN' THEN
                RAISE EXCEPTION 'Privilege Violation: Telecaller role cannot be promoted to Owner or Admin.';
            END IF;
        END IF;

        -- Guard 3: Inactive/Suspended users cannot unsuspend themselves
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            IF OLD.user_id = auth.uid() AND OLD.status IN ('DISABLED', 'SUSPENDED') THEN
                RAISE EXCEPTION 'Privilege Violation: Suspended or disabled users cannot reactivate their own accounts.';
            END IF;
            IF COALESCE(caller_role, '') NOT IN ('ADMIN', 'OWNER') THEN
                RAISE EXCEPTION 'Privilege Violation: Only Owners and Admins can modify account statuses.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Revoke direct execution on trigger function from untrusted roles
REVOKE EXECUTE ON FUNCTION public.protect_profile_privilege_escalation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_protect_profile_privilege_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privilege_escalation();

-- Tighten RLS Policy on public.profiles: users can only update their own safe attributes
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (
        user_id = auth.uid() AND
        role = (SELECT p.role FROM public.profiles p WHERE p.user_id = auth.uid()) AND
        organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()) AND
        status = (SELECT p.status FROM public.profiles p WHERE p.user_id = auth.uid())
    );

-- ----------------------------------------------------------------------------
-- 3. ZERO-PHONE-EXPOSURE INVARIANT ON DIRECT LEADS ACCESS & VIEW
-- ----------------------------------------------------------------------------

-- Telecallers must NEVER query the raw phone column on public.leads directly.
-- Revoke direct telecaller SELECT on public.leads; they must access telecaller_leads_view.
DROP POLICY IF EXISTS "Telecallers view only assigned leads" ON public.leads;
DROP POLICY IF EXISTS "Admins view org leads" ON public.leads;
DROP POLICY IF EXISTS "Owners manage org leads" ON public.leads;

-- Admins & Owners have full management of leads within their organization
CREATE POLICY "Admins and Owners manage org leads" ON public.leads
    FOR ALL
    TO authenticated
    USING (
        public.get_auth_role() = 'ADMIN' OR
        (organization_id = public.get_auth_org_id() AND public.get_auth_role() = 'OWNER')
    )
    WITH CHECK (
        public.get_auth_role() = 'ADMIN' OR
        (organization_id = public.get_auth_org_id() AND public.get_auth_role() = 'OWNER')
    );

-- Telecallers have UPDATE ONLY on assigned leads (e.g. status, notes)
-- Direct SELECT is forbidden (RLS default deny on SELECT for TELECALLER role)
DROP POLICY IF EXISTS "Telecallers update only assigned leads" ON public.leads;
CREATE POLICY "Telecallers update only assigned leads" ON public.leads
    FOR UPDATE
    TO authenticated
    USING (
        organization_id = public.get_auth_org_id() AND
        public.get_auth_role() = 'TELECALLER' AND
        assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
    WITH CHECK (
        organization_id = public.get_auth_org_id() AND
        public.get_auth_role() = 'TELECALLER' AND
        assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- Refresh telecaller_leads_view with operational audit metrics (last_contacted_at, calls_count)
-- while preserving strict zero phone exposure:
-- - Phone column completely omitted
-- - Arbitrary metadata omitted
-- - Free-text notes scrubbed of phone numbers
-- - Digits stripped from father_name, mother_name, city, state
-- - Digit sequences >= 5 redacted from educational fields
DROP VIEW IF EXISTS public.telecaller_leads_view;
CREATE OR REPLACE VIEW public.telecaller_leads_view AS
SELECT
    l.id,
    l.organization_id,
    l.lead_code,
    SUBSTRING(l.name FROM 1 FOR POSITION(' ' IN l.name || ' ')) || ' ' || SUBSTRING(SUBSTRING(l.name FROM POSITION(' ' IN l.name || ' ') + 1) FROM 1 FOR 1) || '.' AS name,
    '***@***.***' AS email,
    l.source,
    l.status,
    l.priority,
    l.assigned_to,
    REGEXP_REPLACE(l.notes, '((?:\+?\(?|[0-9])[\d\s\-_./,()]{5,}[0-9])', '[PHONE PROTECTED]', 'g') AS notes,
    REGEXP_REPLACE(l.father_name, '[0-9]', '', 'g') AS father_name,
    REGEXP_REPLACE(l.mother_name, '[0-9]', '', 'g') AS mother_name,
    l.neet_score,
    l.neet_rank,
    l.neet_year,
    l.neet_attempts,
    l.eamcet_score,
    l.eamcet_rank,
    l.eamcet_year,
    l.eamcet_attempts,
    l.ipe_marks,
    l.ipe_percentage,
    l.ipe_year,
    l.ipe_attempts,
    l.category,
    l.gender,
    REGEXP_REPLACE(l.city, '[0-9]', '', 'g') AS city,
    REGEXP_REPLACE(l.state, '[0-9]', '', 'g') AS state,
    REGEXP_REPLACE(l.school_or_college, '[0-9]{5,}', '[REDACTED]', 'g') AS school_or_college,
    REGEXP_REPLACE(l.course_interest, '[0-9]{5,}', '[REDACTED]', 'g') AS course_interest,
    l.last_contacted_at,
    l.calls_count,
    l.created_at,
    l.updated_at
FROM public.leads l
WHERE l.assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid());

REVOKE ALL ON public.telecaller_leads_view FROM anon, PUBLIC;
GRANT SELECT ON public.telecaller_leads_view TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC FUNCTION HARDENING: ZERO PHONE RETURN (public.initiate_authorized_call)
-- ----------------------------------------------------------------------------

-- Redefine initiate_authorized_call with pinned search path and zero phone return
CREATE OR REPLACE FUNCTION public.initiate_authorized_call(target_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    caller_profile public.profiles;
    target_lead public.leads;
    call_session_id UUID;
BEGIN
    -- 1. Identify and authenticate caller
    SELECT * INTO caller_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
    IF caller_profile.id IS NULL OR caller_profile.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated or inactive caller profile.';
    END IF;

    -- 2. Retrieve target lead (internal query; phone NOT selected into return payload)
    SELECT * INTO target_lead FROM public.leads WHERE id = target_lead_id LIMIT 1;
    IF target_lead.id IS NULL THEN
        RAISE EXCEPTION 'Target lead not found.';
    END IF;

    -- 3. Multi-tenant organization isolation
    IF caller_profile.role != 'ADMIN' AND target_lead.organization_id != caller_profile.organization_id THEN
        INSERT INTO public.security_events (organization_id, user_id, event_type, severity, description)
        VALUES (
            caller_profile.organization_id,
            caller_profile.id,
            'CROSS_TENANT_CALL_ATTEMPT',
            'CRITICAL',
            CONCAT('User ', caller_profile.full_name, ' attempted unauthorized cross-tenant call to lead ', target_lead.id)
        );
        RAISE EXCEPTION 'Forbidden: Lead belongs to another organization.';
    END IF;

    -- 4. Telecaller assignment verification
    IF caller_profile.role = 'TELECALLER' AND target_lead.assigned_to != caller_profile.id THEN
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
    call_session_id := gen_random_uuid();
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
        'TWILIO',
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
        'CALL_STARTED',
        'call',
        call_session_id,
        jsonb_build_object('leadCode', target_lead.lead_code, 'status', 'INITIATED')
    );

    -- 7. Return safe session details to client — STRICT ZERO PHONE EXPOSURE
    -- Zero phone digits, zero masked phone fields
    RETURN jsonb_build_object(
        'call_id', call_session_id,
        'lead_id', target_lead.id,
        'lead_code', target_lead.lead_code,
        'status', 'INITIATED'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.initiate_authorized_call(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_authorized_call(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC FUNCTION HARDENING: ZERO PHONE STUDENT DETAILS (public.get_telecaller_student_detail)
-- ----------------------------------------------------------------------------

-- Redefine get_telecaller_student_detail with pinned search path, zero phone exposure,
-- and strict attribute sanitization
CREATE OR REPLACE FUNCTION public.get_telecaller_student_detail(target_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    caller_profile public.profiles;
    target_lead public.leads;
BEGIN
    -- 1. Identify caller profile
    SELECT * INTO caller_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
    IF caller_profile.id IS NULL OR caller_profile.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated or inactive profile.';
    END IF;

    -- 2. Fetch target lead
    SELECT * INTO target_lead FROM public.leads WHERE id = target_lead_id LIMIT 1;
    IF target_lead.id IS NULL THEN
        RAISE EXCEPTION 'Lead not found or unauthorized.';
    END IF;

    -- 3. Multi-tenant isolation check
    IF caller_profile.role != 'ADMIN' AND target_lead.organization_id != caller_profile.organization_id THEN
        INSERT INTO public.security_events (organization_id, user_id, event_type, severity, description)
        VALUES (
            caller_profile.organization_id,
            caller_profile.id,
            'CROSS_TENANT_LEAD_ACCESS_ATTEMPT',
            'CRITICAL',
            CONCAT('User ', caller_profile.full_name, ' attempted unauthorized cross-tenant detail view for lead ', target_lead.id)
        );
        RAISE EXCEPTION 'Lead not found or unauthorized.';
    END IF;

    -- 4. Enforce telecaller assignment verification
    IF caller_profile.role = 'TELECALLER' AND target_lead.assigned_to != caller_profile.id THEN
        INSERT INTO public.security_events (organization_id, user_id, event_type, severity, description)
        VALUES (
            caller_profile.organization_id,
            caller_profile.id,
            'UNAUTHORIZED_LEAD_ACCESS_ATTEMPT',
            'HIGH',
            CONCAT('Telecaller ', caller_profile.full_name, ' attempted unauthorized access to unassigned lead.')
        );
        RAISE EXCEPTION 'Forbidden: You do not have permission to access this lead.';
    END IF;

    -- 5. Record lead-detail access audit log (without sensitive contact values)
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
        'LEAD_DETAILS_ACCESSED',
        'lead',
        target_lead.id,
        jsonb_build_object(
            'leadId', target_lead.id,
            'leadCode', target_lead.lead_code,
            'accessedAt', NOW()
        )
    );

    -- 6. Return strictly authorized student fields (ZERO PHONE EXPOSURE)
    -- Free-text notes scrubbed, digits stripped from name/city/state, 5+ digits redacted
    RETURN jsonb_build_object(
        'id', target_lead.id,
        'organization_id', target_lead.organization_id,
        'lead_code', target_lead.lead_code,
        'name', target_lead.name,
        'email', CASE WHEN caller_profile.role = 'TELECALLER' THEN '***@***.***' ELSE target_lead.email END,
        'source', target_lead.source,
        'status', target_lead.status,
        'priority', target_lead.priority,
        'notes', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(target_lead.notes, '((?:\+?\(?|[0-9])[\d\s\-_./,()]{5,}[0-9])', '[PHONE PROTECTED]', 'g')
            ELSE target_lead.notes 
        END,
        'father_name', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(COALESCE(target_lead.father_name, target_lead.metadata->>'father_name'), '[0-9]', '', 'g')
            ELSE COALESCE(target_lead.father_name, target_lead.metadata->>'father_name')
        END,
        'mother_name', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(COALESCE(target_lead.mother_name, target_lead.metadata->>'mother_name'), '[0-9]', '', 'g')
            ELSE COALESCE(target_lead.mother_name, target_lead.metadata->>'mother_name')
        END,
        'neet_score', COALESCE(target_lead.neet_score, (target_lead.metadata->>'neet_score')::INTEGER),
        'neet_rank', COALESCE(target_lead.neet_rank, (target_lead.metadata->>'neet_rank')::INTEGER),
        'neet_year', COALESCE(target_lead.neet_year, (target_lead.metadata->>'neet_year')::INTEGER),
        'neet_attempts', COALESCE(target_lead.neet_attempts, (target_lead.metadata->>'neet_attempts')::INTEGER),
        'eamcet_score', COALESCE(target_lead.eamcet_score, (target_lead.metadata->>'eamcet_score')::INTEGER),
        'eamcet_rank', COALESCE(target_lead.eamcet_rank, (target_lead.metadata->>'eamcet_rank')::INTEGER),
        'eamcet_year', COALESCE(target_lead.eamcet_year, (target_lead.metadata->>'eamcet_year')::INTEGER),
        'eamcet_attempts', COALESCE(target_lead.eamcet_attempts, (target_lead.metadata->>'eamcet_attempts')::INTEGER),
        'ipe_marks', COALESCE(target_lead.ipe_marks, (target_lead.metadata->>'ipe_marks')::INTEGER),
        'ipe_percentage', COALESCE(target_lead.ipe_percentage, (target_lead.metadata->>'ipe_percentage')::NUMERIC),
        'ipe_year', COALESCE(target_lead.ipe_year, (target_lead.metadata->>'ipe_year')::INTEGER),
        'ipe_attempts', COALESCE(target_lead.ipe_attempts, (target_lead.metadata->>'ipe_attempts')::INTEGER),
        'category', COALESCE(target_lead.category, target_lead.metadata->>'category'),
        'gender', COALESCE(target_lead.gender, target_lead.metadata->>'gender'),
        'city', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(COALESCE(target_lead.city, target_lead.metadata->>'city'), '[0-9]', '', 'g')
            ELSE COALESCE(target_lead.city, target_lead.metadata->>'city')
        END,
        'state', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(COALESCE(target_lead.state, target_lead.metadata->>'state'), '[0-9]', '', 'g')
            ELSE COALESCE(target_lead.state, target_lead.metadata->>'state')
        END,
        'school_or_college', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(COALESCE(target_lead.school_or_college, target_lead.metadata->>'school_or_college'), '[0-9]{5,}', '[REDACTED]', 'g')
            ELSE COALESCE(target_lead.school_or_college, target_lead.metadata->>'school_or_college')
        END,
        'course_interest', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(COALESCE(target_lead.course_interest, target_lead.metadata->>'course_interest'), '[0-9]{5,}', '[REDACTED]', 'g')
            ELSE COALESCE(target_lead.course_interest, target_lead.metadata->>'course_interest')
        END,
        'last_contacted_at', target_lead.last_contacted_at,
        'calls_count', target_lead.calls_count,
        'created_at', target_lead.created_at,
        'updated_at', target_lead.updated_at
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_telecaller_student_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_telecaller_student_detail(UUID) TO authenticated;
