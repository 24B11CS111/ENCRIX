-- ENCRIX Phase 24.3: preserve raw-lead isolation while restoring the
-- assigned telecaller workflow through the existing sanitized projection.

-- The view is the only direct read projection available to browser roles.
-- It already filters to active assigned telecallers and sanitizes free text
-- and phone-like data. Do not relax the restrictive raw-table SELECT policy.
REVOKE ALL ON public.telecaller_leads_view FROM PUBLIC, anon;
GRANT SELECT ON public.telecaller_leads_view TO authenticated;

-- Direct table reads remain hidden from telecallers. This narrowly-scoped RPC
-- is the sole telecaller write path and derives identity and tenant scope from
-- the authenticated database identity and authoritative profile row.
CREATE OR REPLACE FUNCTION public.update_assigned_telecaller_lead(
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
    v_user_id UUID := auth.uid();
    v_profile_id UUID;
    v_organization_id UUID;
    v_updated_rows INTEGER;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated'
       OR v_user_id IS NULL
       OR p_lead_id IS NULL
       OR p_status IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT profile.id, profile.organization_id
      INTO v_profile_id, v_organization_id
      FROM public.profiles AS profile
     WHERE profile.user_id = v_user_id
       AND profile.role = 'TELECALLER'
       AND profile.status = 'ACTIVE'
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Deliberately update only these two approved fields. In particular,
    -- updated_at and assignment/tenant/contact columns remain untouched.
    UPDATE public.leads AS lead
       SET status = p_status,
           notes = p_notes
     WHERE lead.id = p_lead_id
       AND lead.organization_id = v_organization_id
       AND lead.assigned_to = v_profile_id;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    RETURN v_updated_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.update_assigned_telecaller_lead(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_assigned_telecaller_lead(UUID, TEXT, TEXT)
    TO authenticated;

COMMENT ON FUNCTION public.update_assigned_telecaller_lead(UUID, TEXT, TEXT) IS
    'Updates status and notes for the authenticated active telecaller’s assigned lead only; returns false for unauthorized or missing rows.';
