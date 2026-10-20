-- ============================================================================
-- ENCRIX Phase 22.8: Final Phone-Exposure Remediation & Academic Text Hardening
-- Migration: 20261019000000_phase22_phone_exposure_remediation.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PIN SEARCH PATH ON REMAINING SECURITY DEFINER FUNCTIONS
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.get_auth_profile() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_auth_role() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_auth_org_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_audit_tampering() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_caller_active() SET search_path = public, pg_temp;
ALTER FUNCTION public.can_access_call_recording(UUID, UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.can_access_call_recording(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION public.can_access_call_recording_path(TEXT) SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 2. HARDEN telecaller_leads_view: ZERO PHONE EXPOSURE IN NAME & ACADEMIC FIELDS
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.telecaller_leads_view;
CREATE OR REPLACE VIEW public.telecaller_leads_view AS
SELECT
    l.id,
    l.organization_id,
    l.lead_code,
    -- Remove phone digits and delimiters before exposing a first name and initial.
    CASE
        WHEN sanitized_name.clean_name = '' THEN 'Student'
        WHEN POSITION(' ' IN sanitized_name.clean_name) = 0
            THEN sanitized_name.clean_name
        ELSE SPLIT_PART(sanitized_name.clean_name, ' ', 1) || ' ' ||
             LEFT(SPLIT_PART(sanitized_name.clean_name, ' ', 2), 1) || '.'
    END AS name,
    '***@***.***' AS email,
    l.source,
    l.status,
    l.priority,
    l.assigned_to,
    REGEXP_REPLACE(l.notes, '((?:\+?\(?|[0-9])[\d\s\-_./,()]{4,}[0-9])', '[PHONE PROTECTED]', 'g') AS notes,
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
    -- Academic Text Protection: Redact both formatted/chunked phone patterns AND 5+ consecutive digit strings
    REGEXP_REPLACE(
        REGEXP_REPLACE(l.school_or_college, '((?:\+?\(?|[0-9])[\d\s\-_./,()]{4,}[0-9])', '[REDACTED]', 'g'),
        '[0-9]{5,}', '[REDACTED]', 'g'
    ) AS school_or_college,
    REGEXP_REPLACE(
        REGEXP_REPLACE(l.course_interest, '((?:\+?\(?|[0-9])[\d\s\-_./,()]{4,}[0-9])', '[REDACTED]', 'g'),
        '[0-9]{5,}', '[REDACTED]', 'g'
    ) AS course_interest,
    l.last_contacted_at,
    l.calls_count,
    l.created_at,
    l.updated_at
FROM public.leads l
CROSS JOIN LATERAL (
    SELECT BTRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                REGEXP_REPLACE(COALESCE(l.name, ''), '[0-9]', '', 'g'),
                '[-_./,()+]+',
                ' ',
                'g'
            ),
            '[[:space:]]+',
            ' ',
            'g'
        )
    ) AS clean_name
) sanitized_name
WHERE l.assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid());

REVOKE ALL ON public.telecaller_leads_view FROM anon, PUBLIC;
GRANT SELECT ON public.telecaller_leads_view TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. HARDEN public.get_telecaller_student_detail(UUID)
-- ----------------------------------------------------------------------------
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

    -- 5. Record statutory audit log
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
        'name', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN COALESCE(NULLIF(TRIM(REGEXP_REPLACE(target_lead.name, '[0-9\-_./,()+]', '', 'g')), ''), 'Student')
            ELSE target_lead.name 
        END,
        'email', CASE WHEN caller_profile.role = 'TELECALLER' THEN '***@***.***' ELSE target_lead.email END,
        'source', target_lead.source,
        'status', target_lead.status,
        'priority', target_lead.priority,
        'notes', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(target_lead.notes, '((?:\+?\(?|[0-9])[\d\s\-_./,()]{4,}[0-9])', '[PHONE PROTECTED]', 'g')
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
            THEN REGEXP_REPLACE(
                REGEXP_REPLACE(COALESCE(target_lead.school_or_college, target_lead.metadata->>'school_or_college'), '((?:\+?\(?|[0-9])[\d\s\-_./,()]{4,}[0-9])', '[REDACTED]', 'g'),
                '[0-9]{5,}', '[REDACTED]', 'g'
            )
            ELSE COALESCE(target_lead.school_or_college, target_lead.metadata->>'school_or_college')
        END,
        'course_interest', CASE 
            WHEN caller_profile.role = 'TELECALLER' 
            THEN REGEXP_REPLACE(
                REGEXP_REPLACE(COALESCE(target_lead.course_interest, target_lead.metadata->>'course_interest'), '((?:\+?\(?|[0-9])[\d\s\-_./,()]{4,}[0-9])', '[REDACTED]', 'g'),
                '[0-9]{5,}', '[REDACTED]', 'g'
            )
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
