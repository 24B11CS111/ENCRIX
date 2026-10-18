-- ENCRIX Phase 18: Secure Student Details & Zero Phone Exposure
-- Migration: 20261013000000_phase18_secure_student_details_zero_phone.sql

-- 1. Add student family and academic examination columns to public.leads
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS father_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS neet_score INTEGER,
    ADD COLUMN IF NOT EXISTS neet_rank INTEGER,
    ADD COLUMN IF NOT EXISTS neet_year INTEGER,
    ADD COLUMN IF NOT EXISTS neet_attempts INTEGER,
    ADD COLUMN IF NOT EXISTS eamcet_score INTEGER,
    ADD COLUMN IF NOT EXISTS eamcet_rank INTEGER,
    ADD COLUMN IF NOT EXISTS eamcet_year INTEGER,
    ADD COLUMN IF NOT EXISTS eamcet_attempts INTEGER,
    ADD COLUMN IF NOT EXISTS ipe_marks INTEGER,
    ADD COLUMN IF NOT EXISTS ipe_percentage NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS ipe_year INTEGER,
    ADD COLUMN IF NOT EXISTS ipe_attempts INTEGER,
    ADD COLUMN IF NOT EXISTS category VARCHAR(50),
    ADD COLUMN IF NOT EXISTS gender VARCHAR(50),
    ADD COLUMN IF NOT EXISTS city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS state VARCHAR(100),
    ADD COLUMN IF NOT EXISTS school_or_college VARCHAR(255),
    ADD COLUMN IF NOT EXISTS course_interest VARCHAR(255);

-- 2. Update telecaller_leads_view: Zero Phone Column Exposure
-- Replaces old view to completely exclude the 'phone' column from telecaller queries
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
    l.notes,
    l.father_name,
    l.mother_name,
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
    l.city,
    l.state,
    l.school_or_college,
    l.course_interest,
    l.created_at,
    l.updated_at
FROM public.leads l
WHERE l.assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid());

GRANT SELECT ON public.telecaller_leads_view TO authenticated;

-- 3. Stored Procedure: Authorized Student Details Access
-- Verifies caller session, tenant, and assignment; logs audit trail; returns zero phone details
CREATE OR REPLACE FUNCTION public.get_telecaller_student_detail(target_lead_id UUID)
RETURNS JSONB AS $$
DECLARE
    caller_profile public.profiles;
    target_lead public.leads;
BEGIN
    -- 1. Identify caller profile
    SELECT * INTO caller_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
    IF caller_profile.id IS NULL OR caller_profile.status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated or inactive profile.';
    END IF;

    -- 2. Retrieve target lead (without selecting phone into result)
    SELECT * INTO target_lead FROM public.leads WHERE id = target_lead_id LIMIT 1;
    IF target_lead.id IS NULL THEN
        RAISE EXCEPTION 'Lead not found or unauthorized.';
    END IF;

    -- 3. Enforce multi-tenant isolation (prevent cross-tenant snooping)
    IF caller_profile.role != 'ADMIN' AND target_lead.organization_id != caller_profile.organization_id THEN
        -- Auto-raise critical security event
        INSERT INTO public.security_events (organization_id, user_id, event_type, severity, description)
        VALUES (
            caller_profile.organization_id,
            caller_profile.id,
            'CROSS_TENANT_LEAD_ACCESS_ATTEMPT',
            'CRITICAL',
            CONCAT('User ', caller_profile.full_name, ' attempted unauthorized cross-tenant lead access.')
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

    -- 5. Record lead-detail access audit log (without sensitive academic/contact values)
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
    RETURN jsonb_build_object(
        'id', target_lead.id,
        'organization_id', target_lead.organization_id,
        'lead_code', target_lead.lead_code,
        'name', target_lead.name,
        'email', CASE WHEN caller_profile.role = 'TELECALLER' THEN '***@***.***' ELSE target_lead.email END,
        'source', target_lead.source,
        'status', target_lead.status,
        'priority', target_lead.priority,
        'notes', target_lead.notes,
        'father_name', COALESCE(target_lead.father_name, target_lead.metadata->>'father_name'),
        'mother_name', COALESCE(target_lead.mother_name, target_lead.metadata->>'mother_name'),
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
        'city', COALESCE(target_lead.city, target_lead.metadata->>'city'),
        'state', COALESCE(target_lead.state, target_lead.metadata->>'state'),
        'school_or_college', COALESCE(target_lead.school_or_college, target_lead.metadata->>'school_or_college'),
        'course_interest', COALESCE(target_lead.course_interest, target_lead.metadata->>'course_interest'),
        'created_at', target_lead.created_at,
        'updated_at', target_lead.updated_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_telecaller_student_detail(UUID) TO authenticated;
