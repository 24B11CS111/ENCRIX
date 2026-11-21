-- READ-ONLY diagnostics for migrations 20261031130000 and 20261031140000.
-- Run with PostgreSQL 17 psql after independently verifying the local
-- validation container and its port mapping. This script contains SELECT
-- statements and psql client-side control commands only; it performs no DDL,
-- DML, permission changes, or migration-history changes.
--
-- Example (use only the verified isolated local endpoint):
-- psql -X -W -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55426 -U postgres -d postgres -f supabase/tests/diagnose_review_migrations.sql

\set ON_ERROR_STOP on

SELECT 'DATABASE_IDENTITY' AS label,
       current_database() AS database_name,
       current_user AS connected_role,
       current_setting('server_version') AS server_version,
       current_setting('server_version_num') AS server_version_num,
       current_setting('port') AS server_port,
       inet_server_addr()::text AS server_address;

SELECT (
  current_database() = 'postgres'
  AND current_user = 'postgres'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND current_setting('port') = '5432'
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role')
) AS identity_ok \gset
\if :identity_ok
  \echo IDENTITY_GUARD PASS: postgres database, postgres role, PostgreSQL 17, container port 5432
\else
  \echo IDENTITY_GUARD BLOCKED: verify the isolated container and database before continuing
  \quit 3
\endif

SELECT (
  pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')::oid
      AND a.attname = 'version' AND a.attnum > 0 AND NOT a.attisdropped
  )
) AS migration_history_queryable \gset
\if :migration_history_queryable
  SELECT 'MIGRATION_HISTORY' AS label, version::text, count(*) AS recorded_count
  FROM supabase_migrations.schema_migrations
  WHERE version::text IN ('20261031130000','20261031140000')
  GROUP BY version::text
  ORDER BY version::text;
  SELECT count(*) FILTER (WHERE version::text='20261031130000') AS history_130000,
         count(*) FILTER (WHERE version::text='20261031140000') AS history_140000
  FROM supabase_migrations.schema_migrations
  WHERE version::text IN ('20261031130000','20261031140000') \gset
\else
  \echo MIGRATION_HISTORY BLOCKED: supabase_migrations.schema_migrations or its version column is missing
  \set migration_history_queryable false
  \set history_130000 0
  \set history_140000 0
\endif

\echo LEADS_ACL_BEGIN
SELECT c.oid::regclass AS relation,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.relacl AS stored_table_acl
FROM pg_catalog.pg_class c
WHERE c.oid = pg_catalog.to_regclass('public.leads')::oid;

SELECT CASE WHEN pg_catalog.to_regclass('public.leads') IS NULL
            THEN 'BLOCKED: public.leads missing'
            ELSE 'PASS: public.leads exists' END AS leads_relation_check;

SELECT a.attname AS column_name,
       a.attacl AS stored_column_acl
FROM pg_catalog.pg_attribute a
WHERE a.attrelid = COALESCE(pg_catalog.to_regclass('public.leads')::oid, 0::oid)
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT c.relname AS relation_name,
       pg_catalog.pg_get_userbyid(x.grantor) AS grantor,
       CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type,
       x.is_grantable
FROM pg_catalog.pg_class c
CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
WHERE c.oid = pg_catalog.to_regclass('public.leads')::oid
ORDER BY grantee, x.privilege_type;

SELECT a.attname AS column_name,
       pg_catalog.pg_get_userbyid(x.grantor) AS grantor,
       CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type,
       x.is_grantable
FROM pg_catalog.pg_attribute a
CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
WHERE a.attrelid = COALESCE(pg_catalog.to_regclass('public.leads')::oid, 0::oid)
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attname, grantee, x.privilege_type;

SELECT roles.role_name,
       privileges.privilege_name,
       CASE WHEN pg_catalog.to_regclass('public.leads') IS NULL THEN NULL
            ELSE pg_catalog.has_table_privilege(roles.role_name, pg_catalog.to_regclass('public.leads'), privileges.privilege_name)
       END AS effective_table_privilege
FROM (VALUES ('anon'),('authenticated'),('service_role'),('postgres')) roles(role_name)
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) privileges(privilege_name)
ORDER BY roles.role_name, privileges.privilege_name;

SELECT a.attname AS column_name,
       roles.role_name,
       privileges.privilege_name,
       pg_catalog.has_column_privilege(roles.role_name, a.attrelid, a.attname, privileges.privilege_name) AS effective_column_privilege
FROM pg_catalog.pg_attribute a
CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('postgres')) roles(role_name)
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privileges(privilege_name)
WHERE a.attrelid = COALESCE(pg_catalog.to_regclass('public.leads')::oid, 0::oid)
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum, roles.role_name, privileges.privilege_name;

SELECT target.signature AS exact_signature,
       p.oid IS NOT NULL AS exists,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_userbyid(p.proowner) END AS owner,
       p.prosecdef AS security_definer,
       p.proconfig,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_role_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE') END AS postgres_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_functiondef(p.oid) END AS function_definition
FROM (VALUES
  ('public.initiate_authorized_call(uuid)'),
  ('public.get_telecaller_student_detail(uuid)')
) AS target(signature)
LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(target.signature)::oid
ORDER BY target.signature;

SELECT parent.rolname AS granted_role,
       member.rolname AS member_role,
       grantor.rolname AS grantor,
       m.admin_option,
       m.inherit_option,
       m.set_option
FROM pg_catalog.pg_auth_members m
JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
JOIN pg_catalog.pg_roles member ON member.oid=m.member
JOIN pg_catalog.pg_roles grantor ON grantor.oid=m.grantor
WHERE parent.rolname IN ('anon','authenticated','service_role','postgres')
   OR member.rolname IN ('anon','authenticated','service_role','postgres')
ORDER BY parent.rolname, member.rolname;

SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS creator_role,
       CASE WHEN d.defaclnamespace=0 THEN '<global>' ELSE n.nspname END AS schema_name,
       d.defaclobjtype AS object_type_code,
       x.grantor::pg_catalog.regrole AS grantor,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::text END AS grantee,
       x.privilege_type,
       x.is_grantable
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
WHERE d.defaclnamespace IN ('0'::oid, 'public'::pg_catalog.regnamespace)
ORDER BY schema_name, d.defaclobjtype, grantee, x.privilege_type;
\echo LEADS_ACL_END

\echo FUNCTION_CATALOG_BEGIN
WITH targets(signature, expected_authenticated_execute, expected_service_execute) AS (
  VALUES
    ('public.begin_caller_phone_enrollment(uuid,uuid,text,text)', false, true),
    ('public.complete_caller_phone_enrollment(uuid,uuid,boolean)', false, true),
    ('public.can_access_call_recording(uuid,uuid)', false, true),
    ('public.can_access_call_recording(uuid)', true, true),
    ('public.can_access_call_recording_path(text)', true, true),
    ('public.get_telecaller_student_detail_legacy(uuid)', false, false),
    ('public.is_caller_active()', true, true),
    ('public.restrict_telecaller_lead_update_columns()', false, true)
), resolved AS (
  SELECT t.*, pg_catalog.to_regprocedure(t.signature)::oid AS function_oid
  FROM targets t
)
SELECT r.signature AS exact_signature,
       p.oid IS NOT NULL AS exists,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_userbyid(p.proowner) END AS owner,
       p.prosecdef AS security_definer,
       p.proconfig,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_role_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE') END AS postgres_execute,
       r.expected_authenticated_execute,
       r.expected_service_execute,
       CASE WHEN p.oid IS NULL THEN 'BLOCKED: missing signature'
            WHEN p.prosecdef IS DISTINCT FROM true THEN 'BLOCKED: not SECURITY DEFINER'
            WHEN pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres' THEN 'REVIEW: owner differs from regression expectation'
            WHEN p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'] THEN 'TARGET_PATH_ALREADY_SET'
            WHEN p.proconfig @> ARRAY['search_path=public, pg_temp'] THEN 'EXPECTED_PRE_MIGRATION_PATH'
            ELSE 'REVIEW: nonstandard search_path' END AS path_comparison,
       (pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') IS FALSE
        AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')=r.expected_authenticated_execute
        AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')=r.expected_service_execute) AS expected_api_execute_matrix
FROM resolved r
LEFT JOIN pg_catalog.pg_proc p ON p.oid=r.function_oid
ORDER BY r.signature;
\echo FUNCTION_CATALOG_END

-- Migration 130000 final-state evidence. These are classification inputs, not
-- a substitute for reviewing stored ACL entries and the function definitions
-- printed above. The recorded-history count is supplied by the guarded query.
WITH leads AS (
  SELECT pg_catalog.to_regclass('public.leads')::oid AS relid
), table_state AS (
  SELECT
    l.relid IS NOT NULL AS relation_exists,
    NOT EXISTS (
      SELECT 1 FROM (VALUES ('anon'),('authenticated')) r(role_name)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) v(privilege_name)
      WHERE l.relid IS NOT NULL AND pg_catalog.has_table_privilege(r.role_name,l.relid,v.privilege_name)
    ) AS no_direct_api_table_privileges,
    l.relid IS NOT NULL AND pg_catalog.has_table_privilege('service_role',l.relid,'SELECT')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'INSERT')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'DELETE')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'TRUNCATE')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'REFERENCES')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'TRIGGER')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'MAINTAIN')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'UPDATE') AS service_table_acl_ok
  FROM leads l
), column_state AS (
  SELECT
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      CROSS JOIN (VALUES ('anon'),('authenticated')) r(role_name)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(privilege_name)
      WHERE a.attrelid=COALESCE((SELECT relid FROM leads),0::oid)
        AND a.attnum>0 AND NOT a.attisdropped
        AND pg_catalog.has_column_privilege(r.role_name,a.attrelid,a.attname,v.privilege_name)
    ) AS no_direct_api_column_privileges,
    (SELECT pg_catalog.count(*)=5 AND pg_catalog.bool_and(
       a.attname IN ('assigned_to','status','updated_at','priority','notes')
       AND x.privilege_type='UPDATE' AND NOT x.is_grantable)
     FROM pg_catalog.pg_attribute a
     CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
     WHERE a.attrelid=COALESCE((SELECT relid FROM leads),0::oid)
       AND a.attnum>0 AND NOT a.attisdropped AND x.grantee='service_role'::pg_catalog.regrole
    ) AS service_column_acl_ok
), defaults_state AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
    WHERE d.defaclrole='postgres'::pg_catalog.regrole
      AND d.defaclnamespace='public'::pg_catalog.regnamespace
      AND d.defaclobjtype IN ('r','S','f')
      AND (x.grantee IN ('anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole,'service_role'::pg_catalog.regrole)
        OR (d.defaclobjtype IN ('r','S') AND x.grantee=0))
  ) AS public_defaults_hardened,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
    WHERE d.defaclrole='postgres'::pg_catalog.regrole
      AND d.defaclnamespace='0'::oid
      AND d.defaclobjtype IN ('r','S','f')
      AND (x.grantee IN ('anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole,'service_role'::pg_catalog.regrole)
        OR (d.defaclobjtype IN ('r','S') AND x.grantee=0)
        OR (d.defaclobjtype='f' AND x.grantee=0 AND x.privilege_type='EXECUTE'))
  ) AS global_preflight_ok
), altered_functions AS (
  SELECT
    (SELECT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
       FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.initiate_authorized_call(uuid)')::oid) AS call_path_ok,
    (SELECT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
       FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.get_telecaller_student_detail(uuid)')::oid) AS detail_path_ok,
    (SELECT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') IS FALSE
       AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') IS TRUE
       FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.get_telecaller_student_detail(uuid)')::oid) AS detail_acl_ok,
    (SELECT pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),'target_organization_id')>0
       AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),'IS DISTINCT FROM caller_profile.organization_id')>0
       FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.get_telecaller_student_detail(uuid)')::oid) AS tenant_guard_present
), evidence AS (
  SELECT t.relation_exists,t.no_direct_api_table_privileges,t.service_table_acl_ok,
         c.no_direct_api_column_privileges,c.service_column_acl_ok,d.public_defaults_hardened,
         f.call_path_ok,f.detail_path_ok,f.detail_acl_ok,f.tenant_guard_present,
         d.global_preflight_ok,
         (t.no_direct_api_table_privileges AND t.service_table_acl_ok
          AND c.no_direct_api_column_privileges AND COALESCE(c.service_column_acl_ok,false)
          AND d.public_defaults_hardened AND d.global_preflight_ok AND COALESCE(f.call_path_ok,false)
          AND COALESCE(f.detail_path_ok,false) AND COALESCE(f.detail_acl_ok,false)
          AND COALESCE(f.tenant_guard_present,false)) AS all_target_effects_present
  FROM table_state t CROSS JOIN column_state c CROSS JOIN defaults_state d CROSS JOIN altered_functions f
)
SELECT 'MIGRATION_20261031130000_CLASSIFICATION' AS label,
       CASE WHEN NOT e.relation_exists OR NOT e.global_preflight_ok THEN 'BLOCKED'
            WHEN :'migration_history_queryable'::boolean IS NOT TRUE THEN 'BLOCKED'
            WHEN :history_130000::integer > 1 THEN 'BLOCKED'
            WHEN e.all_target_effects_present THEN 'ALREADY APPLIED IN SUBSTANCE'
            WHEN :history_130000::integer = 1 THEN 'PARTIALLY APPLIED'
            WHEN (NOT e.no_direct_api_table_privileges OR NOT e.no_direct_api_column_privileges
                  OR e.service_table_acl_ok OR e.service_column_acl_ok OR e.public_defaults_hardened
                  OR e.call_path_ok OR e.detail_path_ok OR e.detail_acl_ok OR e.tenant_guard_present) THEN 'PARTIALLY APPLIED'
            ELSE 'PENDING' END AS classification,
       :history_130000::integer AS migration_history_rows,
       e.*
FROM evidence e;

-- Migration 140000 classification. Every function is compared independently
-- above; this summary only calls it complete if all exact targets and the
-- regression-tested EXECUTE matrix match.
WITH targets(signature) AS (
  VALUES
    ('public.begin_caller_phone_enrollment(uuid,uuid,text,text)'),
    ('public.complete_caller_phone_enrollment(uuid,uuid,boolean)'),
    ('public.can_access_call_recording(uuid,uuid)'),
    ('public.can_access_call_recording(uuid)'),
    ('public.can_access_call_recording_path(text)'),
    ('public.get_telecaller_student_detail_legacy(uuid)'),
    ('public.is_caller_active()'),
    ('public.restrict_telecaller_lead_update_columns()')
), functions AS (
  SELECT t.signature,p.oid,p.prosecdef,p.proconfig,pg_catalog.pg_get_userbyid(p.proowner) AS owner
  FROM targets t LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(t.signature)::oid
), summary AS (
  SELECT pg_catalog.count(*) FILTER (WHERE oid IS NOT NULL) AS found_count,
         pg_catalog.count(*) FILTER (WHERE proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) AS target_path_count,
         pg_catalog.count(*) FILTER (WHERE proconfig @> ARRAY['search_path=public, pg_temp']) AS expected_old_path_count,
         pg_catalog.count(*) FILTER (WHERE oid IS NOT NULL AND prosecdef AND owner='postgres') AS valid_definer_count,
         pg_catalog.count(*) FILTER (WHERE oid IS NOT NULL AND NOT (
           pg_catalog.has_function_privilege('anon',oid,'EXECUTE') IS FALSE
           AND pg_catalog.has_function_privilege('authenticated',oid,'EXECUTE') = (signature IN (
             'public.can_access_call_recording(uuid)',
             'public.can_access_call_recording_path(text)',
             'public.is_caller_active()'))
           AND pg_catalog.has_function_privilege('service_role',oid,'EXECUTE') = (signature <> 'public.get_telecaller_student_detail_legacy(uuid)')
         )) AS acl_mismatch_count
  FROM functions
)
SELECT 'MIGRATION_20261031140000_CLASSIFICATION' AS label,
       CASE WHEN found_count<>8 OR valid_definer_count<>8 OR acl_mismatch_count<>0 THEN 'BLOCKED'
            WHEN :'migration_history_queryable'::boolean IS NOT TRUE THEN 'BLOCKED'
            WHEN target_path_count=8 THEN 'ALREADY APPLIED IN SUBSTANCE'
            WHEN :history_140000::integer > 0 THEN 'PARTIALLY APPLIED'
            WHEN expected_old_path_count=8 THEN 'PENDING'
            WHEN target_path_count>0 OR expected_old_path_count>0 THEN 'PARTIALLY APPLIED'
            ELSE 'BLOCKED' END AS classification,
       :history_140000::integer AS migration_history_rows,
       found_count,target_path_count,expected_old_path_count,valid_definer_count,acl_mismatch_count
FROM summary;
