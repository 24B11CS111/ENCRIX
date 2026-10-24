-- Phase 24.7: bridge custom server sessions to the sanitized telecaller lead
-- workflow without granting browser roles access to the service operations.
-- The API must authenticate the custom session and supply identity values from
-- its active profile lookup. These functions independently revalidate that
-- identity, tenant, role, status, and assignment before returning or changing data.
--
-- SAFE ROLLBACK PROCEDURE:
-- To roll back this migration safely:
--   DROP FUNCTION IF EXISTS public.server_update_assigned_telecaller_lead(UUID, UUID, UUID, UUID, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.server_get_assigned_telecaller_leads(UUID, UUID, UUID);
-- The underlying leads, profiles, triggers, views, and RLS policies remain untouched.

CREATE OR REPLACE FUNCTION public.server_get_assigned_telecaller_leads(
    p_user_id UUID,
    p_profile_id UUID,
    p_organization_id UUID
)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    lead_code VARCHAR(50),
    name TEXT,
    email TEXT,
    source TEXT,
    status VARCHAR(50),
    priority VARCHAR(50),
    assigned_to UUID,
    notes TEXT,
    last_contacted_at TIMESTAMPTZ,
    calls_count INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT
        lead.id,
        lead.organization_id,
        lead.lead_code,
        CASE
            WHEN pg_catalog.strpos(cleaned.clean_name, ' ') = 0
                THEN COALESCE(NULLIF(cleaned.clean_name, ''), 'Student')
            ELSE pg_catalog.split_part(cleaned.clean_name, ' ', 1) || ' ' ||
                 pg_catalog.left(pg_catalog.split_part(cleaned.clean_name, ' ', 2), 1) || '.'
        END AS name,
        '***@***.***'::TEXT AS email,
        pg_catalog.regexp_replace(lead.source, '[0-9]', '', 'g') AS source,
        lead.status,
        lead.priority,
        lead.assigned_to,
        pg_catalog.regexp_replace(lead.notes, '[0-9]', '', 'g') AS notes,
        lead.last_contacted_at,
        lead.calls_count,
        lead.created_at,
        lead.updated_at
    FROM public.leads AS lead
    JOIN public.profiles AS profile
      ON profile.id = lead.assigned_to
     AND profile.organization_id = lead.organization_id
    CROSS JOIN LATERAL (
        SELECT pg_catalog.btrim(
            pg_catalog.regexp_replace(
                pg_catalog.regexp_replace(
                    pg_catalog.regexp_replace(COALESCE(lead.name, ''), '[0-9]', '', 'g'),
                    '[-_./,()+]+', ' ', 'g'
                ),
                '[[:space:]]+', ' ', 'g'
            )
        ) AS clean_name
    ) AS cleaned
    WHERE profile.user_id = p_user_id
      AND profile.id = p_profile_id
      AND profile.organization_id = p_organization_id
      AND profile.role = 'TELECALLER'
      AND profile.status = 'ACTIVE'
      AND lead.organization_id = p_organization_id
      AND lead.assigned_to = p_profile_id
    ORDER BY lead.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.server_update_assigned_telecaller_lead(
    p_user_id UUID,
    p_profile_id UUID,
    p_organization_id UUID,
    p_lead_id UUID,
    p_status TEXT,
    p_notes TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_profile_exists BOOLEAN;
    v_updated_rows INTEGER;
BEGIN
    IF p_user_id IS NULL OR p_profile_id IS NULL OR p_organization_id IS NULL
       OR p_lead_id IS NULL OR p_status IS NULL OR p_notes IS NULL
       OR p_status NOT IN (
           'NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP',
           'CONVERTED', 'NOT_INTERESTED', 'INVALID', 'DO_NOT_CONTACT'
       ) OR pg_catalog.length(p_notes) > 10000 THEN
        RETURN FALSE;
    END IF;

    SELECT TRUE INTO v_profile_exists
      FROM public.profiles AS profile
     WHERE profile.id = p_profile_id
       AND profile.user_id = p_user_id
       AND profile.organization_id = p_organization_id
       AND profile.role = 'TELECALLER'
       AND profile.status = 'ACTIVE'
     LIMIT 1;

    IF v_profile_exists IS DISTINCT FROM TRUE THEN
        RETURN FALSE;
    END IF;

    -- This function changes exactly the two fields allowed by the existing
    -- telecaller policy and trigger; it never accepts client tenant/assignment data.
    UPDATE public.leads AS lead
       SET status = p_status,
           notes = p_notes
     WHERE lead.id = p_lead_id
       AND lead.organization_id = p_organization_id
       AND lead.assigned_to = p_profile_id;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    RETURN v_updated_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.server_get_assigned_telecaller_leads(UUID, UUID, UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.server_update_assigned_telecaller_lead(UUID, UUID, UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_get_assigned_telecaller_leads(UUID, UUID, UUID)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.server_update_assigned_telecaller_lead(UUID, UUID, UUID, UUID, TEXT, TEXT)
    TO service_role;

COMMENT ON FUNCTION public.server_get_assigned_telecaller_leads(UUID, UUID, UUID) IS
    'Service-role-only sanitized lead projection; caller identity must be derived from an authenticated active server profile.';
COMMENT ON FUNCTION public.server_update_assigned_telecaller_lead(UUID, UUID, UUID, UUID, TEXT, TEXT) IS
    'Service-role-only update of status and notes for a lead assigned to the supplied active telecaller profile in its organization.';
