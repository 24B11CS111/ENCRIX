-- ENCRIX Phase 24.1: forward-only security remediations.
-- Run after 20261023120000_secure_caller_enrollment_bridge_persistence.sql.

-- The legacy RPC creates a database call record without creating a real bridge.
-- Remove every non-owner grant, including PUBLIC/default and service-role grants.
REVOKE ALL PRIVILEGES ON FUNCTION public.initiate_authorized_call(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- Also remove any explicit grant that may have been assigned to another role.
DO $$
DECLARE
    v_grantee_name TEXT;
BEGIN
    FOR v_grantee_name IN
        SELECT DISTINCT grantee.rolname
        FROM pg_proc AS proc
        CROSS JOIN LATERAL aclexplode(
            COALESCE(proc.proacl, acldefault('f', proc.proowner))
        ) AS acl
        JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE proc.oid = 'public.initiate_authorized_call(uuid)'::regprocedure
          AND acl.grantee <> proc.proowner
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION public.initiate_authorized_call(UUID) FROM %I',
            v_grantee_name
        );
    END LOOP;
END;
$$;

-- Authenticated profile creation may still create an unverified profile, but
-- cannot assert a phone number or its verification state. The trusted
-- service-only completion RPC runs without an end-user auth.uid() and remains
-- the sole application path that sets these fields.
CREATE OR REPLACE FUNCTION public.prevent_profile_phone_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.phone IS NOT NULL OR NEW.phone_verified IS DISTINCT FROM FALSE THEN
                RAISE EXCEPTION 'Phone number changes require server-side verification.';
            END IF;
        ELSIF NEW.phone IS DISTINCT FROM OLD.phone
           OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified THEN
            RAISE EXCEPTION 'Phone number changes require server-side verification.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_phone_self_update ON public.profiles;
CREATE TRIGGER trg_prevent_profile_phone_self_update
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_phone_self_update();

-- RLS continues to constrain rows. This trigger additionally limits active
-- telecallers to status and notes on their own assigned lead; every other
-- column, including phone, organization, assignment, identity, and metadata,
-- must remain unchanged. Owners/admins retain their existing RLS-governed edit
-- behavior. Service-role/server operations are unaffected.
CREATE OR REPLACE FUNCTION public.restrict_telecaller_lead_update_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE user_id = auth.uid()
    LIMIT 1;

    IF NOT FOUND OR v_profile.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'An active profile is required to update leads.';
    END IF;

    IF v_profile.role = 'TELECALLER' THEN
        IF OLD.organization_id IS DISTINCT FROM v_profile.organization_id
           OR OLD.assigned_to IS DISTINCT FROM v_profile.id THEN
            RAISE EXCEPTION 'Telecallers may update only leads assigned to them.';
        END IF;

        IF (to_jsonb(NEW) - ARRAY['status', 'notes'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'notes']) THEN
            RAISE EXCEPTION 'Telecallers may update only lead status and notes.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.restrict_telecaller_lead_update_columns()
    FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_restrict_telecaller_lead_update_columns ON public.leads;
CREATE TRIGGER trg_restrict_telecaller_lead_update_columns
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.restrict_telecaller_lead_update_columns();

