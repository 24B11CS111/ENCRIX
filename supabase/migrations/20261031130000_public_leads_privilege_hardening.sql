-- ENCRIX: least-privilege direct access and defaults for public objects.
-- Forward-only. Does not change RLS policies, persisted data, or publication
-- membership. It tightens the lead-detail SECURITY DEFINER tenant boundary.
--
-- App dependencies reviewed: browser lead reads/writes use authenticated API
-- handlers; those handlers use service_role. Owner/admin and telecaller client
-- code does not query public.leads directly. Sanitized Realtime uses
-- public.lead_refresh_signals, not public.leads.
--
-- Future public objects created by postgres require explicit object grants;
-- sensitive functions must also explicitly revoke EXECUTE from PUBLIC.
-- Existing grants other than public.leads and the explicitly reviewed detail
-- function are unchanged.

BEGIN;

-- Schema-specific REVOKEs cannot subtract a global default ACL. The supplied
-- staging dump shows no explicit global postgres defaults; abort if this target
-- differs so the migration cannot silently leave global grants effective.
DO $global_default_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_default_acl AS d
      CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS x
     WHERE d.defaclrole = 'postgres'::regrole
       AND d.defaclnamespace = '0'::oid
       AND d.defaclobjtype IN ('r', 'S', 'f')
       AND (
         x.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
          OR (d.defaclobjtype IN ('r', 'S') AND x.grantee = 0)
         OR (d.defaclobjtype = 'f' AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
       )
  ) THEN
    RAISE EXCEPTION 'Unexpected global postgres default ACL; review it separately before applying public-schema hardening';
  END IF;
END;
$global_default_preflight$;

REVOKE ALL PRIVILEGES ON TABLE public.leads FROM PUBLIC, anon, authenticated, service_role;
-- REVOKE TABLE-level privileges does not remove column ACLs, so remove any
-- historical column grants as well without assuming a frozen leads schema.
DO $migration$
DECLARE
  v_columns text;
BEGIN
  SELECT pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
    FROM pg_catalog.pg_attribute AS a
   WHERE a.attrelid = 'public.leads'::pg_catalog.regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'public.leads has no user columns; refusing privilege migration';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES (%s) ON TABLE public.leads FROM PUBLIC, anon, authenticated, service_role',
    v_columns
  );
END;
$migration$;

-- Keep the reviewed legacy call SECURITY DEFINER function on an explicit
-- catalog-first path. Its application objects are schema-qualified. It remains
-- revoked from API roles; this does not restore its execution permission.
ALTER FUNCTION public.initiate_authorized_call(UUID)
  SET search_path = pg_catalog, public, pg_temp;

-- A role named ADMIN is the platform administrator role (granted only through
-- grant_platform_admin); organization owners must never use that exception to
-- inspect another tenant's lead. Keep the legacy detail projection and its
-- assignment checks, but enforce tenant scope at this public entry point too.
CREATE OR REPLACE FUNCTION public.get_telecaller_student_detail(target_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  caller_profile public.profiles%ROWTYPE;
  target_organization_id UUID;
BEGIN
  SELECT p.*
    INTO caller_profile
    FROM public.profiles AS p
   WHERE p.user_id = auth.uid()
   LIMIT 1;

  IF caller_profile.id IS NULL OR caller_profile.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Access Denied: Unauthenticated or inactive profile.';
  END IF;

  SELECT l.organization_id
    INTO target_organization_id
    FROM public.leads AS l
   WHERE l.id = target_lead_id;

  IF target_organization_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found or unauthorized.';
  END IF;

  IF target_organization_id IS DISTINCT FROM caller_profile.organization_id
     AND caller_profile.role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Lead not found or unauthorized.';
  END IF;

  RETURN public.get_telecaller_student_detail_legacy(target_lead_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_telecaller_student_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_telecaller_student_detail(UUID) TO authenticated;

-- Preserve the existing server-side lead APIs. This grant does not authorize
-- browser calls: the service-role key remains server-only and handlers perform
-- profile, role, assignment, and organization checks before querying leads.
GRANT SELECT ON TABLE public.leads TO service_role;
-- Owner updates and assignment/distribution paths modify only these columns.
-- Follow-up/call/metrics/detail/reminder paths read leads. Row creation and CSV
-- import use service-role-only SECURITY DEFINER RPCs instead.
GRANT UPDATE (assigned_to, status, updated_at, priority, notes)
  ON TABLE public.leads TO service_role;

-- Keep default ACL changes scoped to public. A global table/sequence/function
-- change could affect Supabase-managed or extension objects created in other
-- schemas. Later migrations must explicitly grant privileges they require.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
-- This removes explicit schema defaults to these roles. It does not remove
-- PostgreSQL's inherited global PUBLIC EXECUTE default for new functions.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated, service_role;

-- PostgreSQL's built-in PUBLIC EXECUTE default for new functions is global and
-- cannot be safely removed per schema. This migration intentionally leaves it
-- unchanged; every future sensitive public function must explicitly REVOKE
-- EXECUTE FROM PUBLIC, anon, authenticated and then GRANT only its caller.

COMMIT;
