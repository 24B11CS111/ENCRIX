-- ENCRIX Phase 23.8: Require an active authenticated profile for API data access.

CREATE OR REPLACE FUNCTION public.is_active_authenticated_profile()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM public.profiles p
           WHERE p.user_id = auth.uid()
             AND p.status = 'ACTIVE'
       );
$$;

REVOKE ALL ON FUNCTION public.is_active_authenticated_profile()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_authenticated_profile()
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_caller_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.is_active_authenticated_profile();
$$;

REVOKE ALL ON FUNCTION public.is_caller_active()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_caller_active()
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_auth_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.status = 'ACTIVE'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_auth_profile()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_profile()
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS VARCHAR
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.role
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.status = 'ACTIVE'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_auth_role()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_role()
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_auth_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.organization_id
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.status = 'ACTIVE'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_auth_org_id()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_org_id()
TO authenticated, service_role;

-- Restrictive policies compose with every existing permissive policy. Applying
-- both USING and WITH CHECK blocks inactive users from reads, writes, and
-- changes to rows that would otherwise pass a permissive policy.
DO $$
DECLARE
    target_table RECORD;
    policy_name CONSTANT TEXT := 'active_profile_required_phase23_8';
BEGIN
    FOR target_table IN
        SELECT n.nspname, c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relrowsecurity
    LOOP
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I.%I',
            policy_name,
            target_table.nspname,
            target_table.relname
        );
        EXECUTE format(
            'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_active_authenticated_profile()) WITH CHECK (public.is_active_authenticated_profile())',
            policy_name,
            target_table.nspname,
            target_table.relname
        );
    END LOOP;
END;
$$;
