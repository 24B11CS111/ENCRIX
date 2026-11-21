-- Privilege and tenant-scope regression. Run after
-- 20261031130000_public_leads_privilege_hardening.sql on a disposable/local
-- Supabase database. Temporary fixtures are rolled back at the end.
BEGIN;

DO $test$
DECLARE
  v_role text;
  v_privilege text;
  v_column record;
  v_function_signature regprocedure;
  v_is_security_definer boolean;
  v_function_owner name;
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE EXCEPTION 'FAIL: public.leads does not exist';
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c
          WHERE c.oid = 'public.leads'::regclass) THEN
    RAISE EXCEPTION 'FAIL: public.leads RLS is not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
     WHERE polrelid = 'public.leads'::regclass
       AND polname = 'Telecallers cannot select raw leads'
       AND polpermissive = false
  ) THEN
    RAISE EXCEPTION 'FAIL: restrictive telecaller raw-lead policy is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
     WHERE polrelid = 'public.leads'::regclass
       AND polname = 'Admins and Owners manage org leads'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
     WHERE polrelid = 'public.leads'::regclass
       AND polname = 'Telecallers update only assigned leads'
  ) THEN
    RAISE EXCEPTION 'FAIL: expected owner/admin or assigned-telecaller RLS policy is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS p
     WHERE p.polrelid = 'public.leads'::regclass
       AND p.polname = 'Admins and Owners manage org leads'
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) ILIKE '%get_auth_org_id%'
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) ILIKE '%OWNER%'
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) ILIKE '%ADMIN%'
       AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%get_auth_org_id%'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS p
     WHERE p.polrelid = 'public.leads'::regclass
       AND p.polname = 'Telecallers update only assigned leads'
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) ILIKE '%get_auth_org_id%'
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) ILIKE '%get_auth_role%'
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) ILIKE '%TELECALLER%'
       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) ILIKE '%assigned_to%'
       AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%get_auth_org_id%'
       AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%get_auth_role%'
       AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%TELECALLER%'
       AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%assigned_to%'
  ) THEN
    RAISE EXCEPTION 'FAIL: owner/telecaller tenant-scoping policy expressions changed';
  END IF;
  RAISE NOTICE 'PASS: owner/admin and telecaller RLS policy definitions remain present';

  -- These lead-access SECURITY DEFINER functions execute with the migration
  -- owner's rights; the supplied staging catalog and CLI migrations use
  -- postgres. The service role receives EXECUTE, not table INSERT/DELETE.
  FOREACH v_function_signature IN ARRAY ARRAY[
    'public.guard_org_lead_phone_write()'::regprocedure,
    'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)'::regprocedure,
    'public.import_owner_leads(uuid,uuid,uuid,jsonb)'::regprocedure,
    'public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)'::regprocedure,
    'public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
    'public.update_assigned_telecaller_lead(uuid,text,text)'::regprocedure,
    'public.initiate_authorized_call(uuid)'::regprocedure,
    'public.get_telecaller_student_detail(uuid)'::regprocedure
  ] LOOP
    SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner)::name
      INTO v_is_security_definer, v_function_owner
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_function_signature::oid;
    IF NOT FOUND OR NOT v_is_security_definer OR v_function_owner <> 'postgres' THEN
      RAISE EXCEPTION 'FAIL: % is not SECURITY DEFINER owned by postgres', v_function_signature;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: lead SECURITY DEFINER functions retain the expected postgres owner';
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.oid = 'public.get_telecaller_student_detail(uuid)'::regprocedure
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.oid = 'public.initiate_authorized_call(uuid)'::regprocedure
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
  ) THEN
    RAISE EXCEPTION 'FAIL: reviewed SECURITY DEFINER functions lack catalog-first search_path';
  END IF;
  RAISE NOTICE 'PASS: reviewed lead/call SECURITY DEFINER functions use catalog-first search_path';

  -- anon and authenticated must have no table-level or column-level lead
  -- privileges. This applies equally to authenticated owner, admin, and
  -- telecaller sessions; their approved access is through server APIs.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ] LOOP
      IF pg_catalog.has_table_privilege(v_role, 'public.leads', v_privilege) THEN
        RAISE EXCEPTION 'FAIL: % retains % on public.leads', v_role, v_privilege;
      END IF;
    END LOOP;

    FOR v_column IN
      SELECT a.attname
        FROM pg_catalog.pg_attribute AS a
       WHERE a.attrelid = 'public.leads'::regclass
         AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
        IF pg_catalog.has_column_privilege(v_role, 'public.leads', v_column.attname, v_privilege) THEN
          RAISE EXCEPTION 'FAIL: % retains column % on public.leads.%',
            v_role, v_privilege, v_column.attname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS: anon/authenticated (owner and telecaller sessions) have no direct lead privileges';

  IF NOT pg_catalog.has_table_privilege('service_role', 'public.leads', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: service_role lacks SELECT on public.leads';
  END IF;
  IF pg_catalog.has_table_privilege('service_role', 'public.leads', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: service_role has broader table-level UPDATE than required';
  END IF;
  FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
    IF pg_catalog.has_table_privilege('service_role', 'public.leads', v_privilege) THEN
      RAISE EXCEPTION 'FAIL: service_role retains unnecessary % on public.leads', v_privilege;
    END IF;
  END LOOP;
  FOR v_column IN
    SELECT a.attname
      FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = 'public.leads'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF pg_catalog.has_column_privilege('service_role', 'public.leads', v_column.attname, 'UPDATE')
       IS DISTINCT FROM (v_column.attname IN ('assigned_to', 'status', 'updated_at', 'priority', 'notes')) THEN
      RAISE EXCEPTION 'FAIL: unexpected service_role UPDATE privilege on public.leads.%', v_column.attname;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: service_role has table SELECT and only required lead UPDATE columns';
  RAISE NOTICE 'PASS: service_role lacks direct lead INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN';

  -- Verify stored ACL entries as well as effective privileges. PUBLIC, anon,
  -- and authenticated must have no table or column ACL entry; service_role has
  -- table SELECT and exactly five column-level UPDATE grants.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS c
      CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS x
     WHERE c.oid = 'public.leads'::regclass
       AND x.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
  ) THEN
    RAISE EXCEPTION 'FAIL: PUBLIC/anon/authenticated has a stored table ACL entry on public.leads';
  END IF;
  IF (
    SELECT pg_catalog.count(*) <> 1
        OR pg_catalog.bool_or(x.privilege_type <> 'SELECT' OR x.is_grantable)
      FROM pg_catalog.pg_class AS c
      CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS x
     WHERE c.oid = 'public.leads'::regclass
       AND x.grantee = 'service_role'::regrole
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: service_role table ACL must contain exactly one non-grantable SELECT grant';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS a
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS x
     WHERE a.attrelid = 'public.leads'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'service_role'::regrole
  ) <> 5 OR (
    SELECT pg_catalog.count(*)
      FROM (
        SELECT DISTINCT a.attname, x.privilege_type, x.is_grantable
          FROM pg_catalog.pg_attribute AS a
          CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS x
         WHERE a.attrelid = 'public.leads'::regclass
           AND a.attnum > 0 AND NOT a.attisdropped
           AND x.grantee = 'service_role'::regrole
      ) AS distinct_service_column_acl
  ) <> 5 OR (
    SELECT pg_catalog.count(DISTINCT a.attname)
      FROM pg_catalog.pg_attribute AS a
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS x
     WHERE a.attrelid = 'public.leads'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'service_role'::regrole
  ) <> 5 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS a
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS x
     WHERE a.attrelid = 'public.leads'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'service_role'::regrole
       AND (
         a.attname NOT IN ('assigned_to', 'status', 'updated_at', 'priority', 'notes')
         OR x.privilege_type <> 'UPDATE'
         OR x.is_grantable
       )
  ) THEN
    RAISE EXCEPTION 'FAIL: service_role column ACL must contain exactly five non-grantable UPDATE grants on the approved columns';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS a
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS x
     WHERE a.attrelid = 'public.leads'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
  ) THEN
    RAISE EXCEPTION 'FAIL: PUBLIC/anon/authenticated has a stored column ACL entry on public.leads';
  END IF;
  RAISE NOTICE 'PASS: exact stored table and column ACLs match the service_role allowlist';

  -- The public-schema ACLs are hardened. Global explicit ACLs are a separate
  -- concern: the migration preflight rejects unexpected global grants. The
  -- built-in PUBLIC function EXECUTE default remains unchanged by design.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_default_acl AS d
      CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS x
     WHERE d.defaclrole = 'postgres'::regrole
       AND d.defaclnamespace = 'public'::regnamespace
       AND d.defaclobjtype IN ('r', 'S', 'f')
        AND (
          x.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
          OR (d.defaclobjtype IN ('r', 'S') AND x.grantee = 0)
        )
  ) THEN
    RAISE EXCEPTION 'FAIL: postgres-owned public-schema default ACL still grants API roles';
  END IF;
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
    RAISE EXCEPTION 'FAIL: unexpected global postgres default ACL remains; review separately';
  END IF;
  RAISE NOTICE 'PASS: public-schema postgres defaults are hardened; no unexpected global ACL is present';

  -- Verify known server RPC grants needed to preserve owner/telecaller flows.
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', 'public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', 'public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', 'public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: service_role cannot execute one or more server lead RPCs';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon', 'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', 'public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', 'public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', 'public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: API roles can invoke a service-only lead RPC directly';
  END IF;
  RAISE NOTICE 'PASS: service_role retains owner create/import and telecaller read/update RPC execution';
  RAISE NOTICE 'PASS: anon/authenticated cannot invoke service-only lead RPCs directly';

  IF NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.update_assigned_telecaller_lead(uuid,text,text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.get_telecaller_student_detail(uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', 'public.update_assigned_telecaller_lead(uuid,text,text)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', 'public.get_telecaller_student_detail(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated detail/update RPC access changed or anon can invoke it';
  END IF;
  IF pg_catalog.has_function_privilege(
    'authenticated', 'public.initiate_authorized_call(uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', 'public.initiate_authorized_call(uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role', 'public.initiate_authorized_call(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: revoked initiate_authorized_call is executable by an API role';
  END IF;
  RAISE NOTICE 'PASS: authenticated detail/update RPCs remain; legacy call RPC stays revoked';
END;
$test$;

-- Fixtures live in this transaction and are removed by the final ROLLBACK.
-- A regular organization owner must not read a different tenant's lead; a
-- platform ADMIN promoted through the trusted RPC retains the global capability.
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('e1310000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'acl-owner-a@example.test', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('e1310000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'acl-owner-b@example.test', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('e1310000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'acl-platform-admin@example.test', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now());
INSERT INTO public.organizations (id, name, slug, owner_id) VALUES
  ('e1320000-0000-4000-8000-000000000001', 'Privilege test tenant A', 'acl-test-tenant-a', 'e1330000-0000-4000-8000-000000000001'),
  ('e1320000-0000-4000-8000-000000000002', 'Privilege test tenant B', 'acl-test-tenant-b', 'e1330000-0000-4000-8000-000000000002');
INSERT INTO public.profiles (id, user_id, organization_id, full_name, role, status, phone_verified) VALUES
  ('e1330000-0000-4000-8000-000000000001', 'e1310000-0000-4000-8000-000000000001', 'e1320000-0000-4000-8000-000000000001', 'Privilege test owner A', 'OWNER', 'ACTIVE', TRUE),
  ('e1330000-0000-4000-8000-000000000002', 'e1310000-0000-4000-8000-000000000002', 'e1320000-0000-4000-8000-000000000002', 'Privilege test owner B', 'OWNER', 'ACTIVE', TRUE),
  ('e1330000-0000-4000-8000-000000000003', 'e1310000-0000-4000-8000-000000000003', 'e1320000-0000-4000-8000-000000000001', 'Privilege test platform admin', 'OWNER', 'ACTIVE', TRUE);
INSERT INTO public.leads (id, organization_id, lead_code, name, phone, email) VALUES
  ('e1340000-0000-4000-8000-000000000001', 'e1320000-0000-4000-8000-000000000002', 'ACL-CROSS-TENANT', 'Isolation fixture', '+10000000001', 'acl-fixture@example.test');

-- Promote through the trusted flow only. This mirrors a real ADMIN that still
-- carries its original organization_id and must retain platform-wide access.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', TRUE);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SELECT public.grant_platform_admin('e1330000-0000-4000-8000-000000000003');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', TRUE);
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'e1310000-0000-4000-8000-000000000001', TRUE);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"e1310000-0000-4000-8000-000000000001","role":"authenticated"}', TRUE);
DO $tenant_isolation$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.get_telecaller_student_detail('e1340000-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-organization detail unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF SQLERRM <> 'Lead not found or unauthorized.' THEN
      RAISE EXCEPTION 'FAIL: cross-organization detail was rejected unexpectedly: %', SQLERRM;
    END IF;
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'cross-organization detail unexpectedly succeeded';
  END IF;
  RAISE NOTICE 'PASS: organization owner cannot retrieve another organization lead detail';
END;
$tenant_isolation$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', 'e1310000-0000-4000-8000-000000000003', TRUE);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', TRUE);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"e1310000-0000-4000-8000-000000000003","role":"authenticated"}', TRUE);
DO $platform_admin_scope$
DECLARE
  v_detail jsonb;
BEGIN
  v_detail := public.get_telecaller_student_detail('e1340000-0000-4000-8000-000000000001');
  IF v_detail->>'id' IS DISTINCT FROM 'e1340000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: trusted platform ADMIN lost established cross-organization detail access';
  END IF;
  RAISE NOTICE 'PASS: trusted platform ADMIN retains cross-organization detail access';
END;
$platform_admin_scope$;

ROLLBACK;
