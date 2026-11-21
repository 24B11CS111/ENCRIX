-- Read-only final reconciliation evidence for migrations 20261031130000 and
-- 20261031140000. Run with PostgreSQL 17 psql against the already verified
-- isolated local database. This file contains SELECTs and psql client control
-- commands only. It performs no DDL, DML, role changes, or history changes.
--
-- psql -X -W -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55426 -U postgres -d postgres -f supabase/tests/final_migration_reconciliation.sql

\set ON_ERROR_STOP on

\echo DATABASE_IDENTITY_BEGIN
SELECT current_database() AS current_database,
       current_user AS connected_role,
       session_user AS session_role,
       version() AS version,
       current_setting('server_version_num') AS server_version_num,
       inet_server_addr() AS inet_server_addr,
       inet_server_port() AS inet_server_port,
       (current_database()='postgres'
        AND current_user='postgres'
        AND session_user='postgres'
        AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
        AND inet_server_port()=5432
        AND inet_server_addr() IS NOT NULL) AS identity_matches_expected_local_tuple;
\echo DATABASE_IDENTITY_END

SELECT (
  current_database()='postgres'
  AND current_user='postgres'
  AND session_user='postgres'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND inet_server_port()=5432
  AND inet_server_addr() IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role')
) AS identity_guard_ok \gset
\if :identity_guard_ok
  \echo IDENTITY_GUARD PASS: local PostgreSQL 17 Supabase identity tuple; compare printed server address with the isolated container metadata
\else
  \echo IDENTITY_GUARD BLOCKED: stopping before catalog diagnostics; verify isolated database identity
  \quit 3
\endif

\echo REPOSITORY_MIGRATION_EXECUTION_ROLE
SELECT 'UNKNOWN' AS finding,
       'supabase/config.toml and package.json do not specify the database role used for prior migration execution; no repository migration runner or SET ROLE statement establishes it' AS evidence;

SELECT (
  pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid=pg_catalog.to_regclass('supabase_migrations.schema_migrations')::oid
       AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped
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
  \echo MIGRATION_HISTORY BLOCKED: history relation/version column missing
  \set history_130000 -1
  \set history_140000 -1
\endif

\echo LEADS_RELATION_AND_STORED_TABLE_ACL_BEGIN
SELECT c.oid::regclass AS relation,
       pg_catalog.pg_get_userbyid(c.relowner) AS relation_owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.relacl AS complete_stored_relacl
  FROM pg_catalog.pg_class c
 WHERE c.oid=pg_catalog.to_regclass('public.leads')::oid;

SELECT pg_catalog.pg_get_userbyid(x.grantor) AS grantor,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::text END AS grantee,
       x.privilege_type,
       x.is_grantable
  FROM pg_catalog.pg_class c
 CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
 WHERE c.oid=pg_catalog.to_regclass('public.leads')::oid
 ORDER BY grantee,x.privilege_type,grantor;
\echo LEADS_RELATION_AND_STORED_TABLE_ACL_END

\echo LEADS_ALL_STORED_COLUMN_ACLS_BEGIN
SELECT a.attnum,
       a.attname AS column_name,
       a.attacl AS complete_stored_column_acl
  FROM pg_catalog.pg_attribute a
 WHERE a.attrelid=COALESCE(pg_catalog.to_regclass('public.leads')::oid,0::oid)
   AND a.attnum>0 AND NOT a.attisdropped
 ORDER BY a.attnum;

SELECT a.attname AS column_name,
       pg_catalog.pg_get_userbyid(x.grantor) AS grantor,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::text END AS grantee,
       x.privilege_type,
       x.is_grantable
  FROM pg_catalog.pg_attribute a
 CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
 WHERE a.attrelid=COALESCE(pg_catalog.to_regclass('public.leads')::oid,0::oid)
   AND a.attnum>0 AND NOT a.attisdropped
 ORDER BY a.attnum,grantee,x.privilege_type,grantor;
\echo LEADS_ALL_STORED_COLUMN_ACLS_END

\echo LEADS_EFFECTIVE_TABLE_PRIVILEGES_BEGIN
SELECT r.role_name,
       p.privilege_name,
       CASE WHEN role_row.oid IS NULL OR pg_catalog.to_regclass('public.leads') IS NULL THEN NULL
            ELSE pg_catalog.has_table_privilege(r.role_name,pg_catalog.to_regclass('public.leads'),p.privilege_name)
       END AS effective_privilege,
       role_row.oid IS NOT NULL AS role_exists
  FROM (VALUES ('anon'),('authenticated'),('service_role'),('postgres'),('supabase_admin')) r(role_name)
 CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege_name)
  LEFT JOIN pg_catalog.pg_roles role_row ON role_row.rolname=r.role_name
 ORDER BY r.role_name,p.privilege_name;
\echo LEADS_EFFECTIVE_TABLE_PRIVILEGES_END

\echo LEADS_EFFECTIVE_COLUMN_PRIVILEGES_BEGIN
SELECT a.attnum,
       a.attname AS column_name,
       r.role_name,
       p.privilege_name,
       CASE WHEN role_row.oid IS NULL THEN NULL
            ELSE pg_catalog.has_column_privilege(r.role_name,a.attrelid,a.attname,p.privilege_name)
       END AS effective_privilege,
       role_row.oid IS NOT NULL AS role_exists
  FROM pg_catalog.pg_attribute a
 CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('postgres'),('supabase_admin')) r(role_name)
 CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege_name)
  LEFT JOIN pg_catalog.pg_roles role_row ON role_row.rolname=r.role_name
 WHERE a.attrelid=COALESCE(pg_catalog.to_regclass('public.leads')::oid,0::oid)
   AND a.attnum>0 AND NOT a.attisdropped
 ORDER BY a.attnum,r.role_name,p.privilege_name;
\echo LEADS_EFFECTIVE_COLUMN_PRIVILEGES_END

\echo DEFAULT_ACLS_BEGIN
WITH target_roles(role_name) AS (
  VALUES ('postgres'),('supabase_admin')
), target_types(object_type_code) AS (
  VALUES ('r'::"char"),('S'::"char"),('f'::"char")
), targets AS (
  SELECT r.role_name,t.object_type_code,pg_catalog.to_regrole(r.role_name)::oid AS role_oid
    FROM target_roles r CROSS JOIN target_types t
)
SELECT t.role_name AS creator_role,
       'public' AS target_schema,
       t.object_type_code,
       x.grantor::pg_catalog.regrole AS grantor,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::text END AS grantee,
       x.privilege_type,
       x.is_grantable,
       d.oid IS NOT NULL AS explicit_default_acl_row
  FROM targets t
  LEFT JOIN pg_catalog.pg_default_acl d
    ON d.defaclrole=t.role_oid
    AND d.defaclnamespace=pg_catalog.to_regnamespace('public')::oid
   AND d.defaclobjtype=t.object_type_code
  LEFT JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x ON TRUE
 ORDER BY t.role_name,t.object_type_code,grantee,x.privilege_type;

WITH targets AS (
  SELECT r.role_name,t.object_type_code,pg_catalog.to_regrole(r.role_name)::oid AS role_oid
    FROM (VALUES ('postgres'),('supabase_admin')) r(role_name)
   CROSS JOIN (VALUES ('r'::"char"),('S'::"char"),('f'::"char")) t(object_type_code)
)
SELECT t.role_name AS creator_role,
       '<global>' AS target_schema,
       t.object_type_code,
       x.grantor::pg_catalog.regrole AS grantor,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::pg_catalog.regrole::text END AS grantee,
       x.privilege_type,
       x.is_grantable,
       d.oid IS NOT NULL AS explicit_default_acl_row
  FROM targets t
  LEFT JOIN pg_catalog.pg_default_acl d
    ON d.defaclrole=t.role_oid AND d.defaclnamespace='0'::oid AND d.defaclobjtype=t.object_type_code
  LEFT JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x ON TRUE
 ORDER BY t.role_name,t.object_type_code,grantee,x.privilege_type;
\echo DEFAULT_ACLS_END

\echo LEAD_FUNCTIONS_MODIFIED_BY_130000_BEGIN
SELECT target.signature,
       p.oid IS NOT NULL AS exists,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_userbyid(p.proowner) END AS owner,
       p.prosecdef AS security_definer,
       p.proconfig,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_role_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_functiondef(p.oid) END AS complete_definition
  FROM (VALUES
    ('public.initiate_authorized_call(uuid)'),
    ('public.get_telecaller_student_detail(uuid)')
  ) target(signature)
  LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(target.signature)::oid
 ORDER BY target.signature;
\echo LEAD_FUNCTIONS_MODIFIED_BY_130000_END

\echo FUNCTIONS_MODIFIED_BY_140000_BEGIN
WITH targets(signature,expected_authenticated,expected_service) AS (
  VALUES
    ('public.begin_caller_phone_enrollment(uuid,uuid,text,text)',false,true),
    ('public.complete_caller_phone_enrollment(uuid,uuid,boolean)',false,true),
    ('public.can_access_call_recording(uuid,uuid)',false,true),
    ('public.can_access_call_recording(uuid)',true,true),
    ('public.can_access_call_recording_path(text)',true,true),
    ('public.get_telecaller_student_detail_legacy(uuid)',false,false),
    ('public.is_caller_active()',true,true),
    ('public.restrict_telecaller_lead_update_columns()',false,true)
), resolved AS (
  SELECT t.*,pg_catalog.to_regprocedure(t.signature)::oid AS function_oid FROM targets t
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
       r.expected_authenticated,
       r.expected_service,
       CASE WHEN p.oid IS NULL THEN false
            ELSE p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
              AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
              AND pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') IS FALSE
              AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')=r.expected_authenticated
              AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')=r.expected_service
       END AS matches_migration_140000_target
  FROM resolved r
  LEFT JOIN pg_catalog.pg_proc p ON p.oid=r.function_oid
 ORDER BY r.signature;
\echo FUNCTIONS_MODIFIED_BY_140000_END

-- Determine history counts without writing to migration history.
SELECT (
  pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=pg_catalog.to_regclass('supabase_migrations.schema_migrations')::oid
      AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped)
) AS history_is_queryable \gset
\if :history_is_queryable
  SELECT count(*) FILTER (WHERE version::text='20261031130000') AS count_130000,
         count(*) FILTER (WHERE version::text='20261031140000') AS count_140000
    FROM supabase_migrations.schema_migrations
   WHERE version::text IN ('20261031130000','20261031140000') \gset
\else
  \set count_130000 -1
  \set count_140000 -1
\endif

-- Final evidence classifications intentionally require full target state and
-- a queryable history. The address still must be matched to Docker/container
-- metadata by the operator; inet_server_addr is printed above for that check.
WITH identity_evidence AS (
  SELECT current_database()='postgres'
     AND current_user='postgres'
     AND session_user='postgres'
     AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
     AND inet_server_port()=5432
     AND inet_server_addr() IS NOT NULL AS tuple_matches
), leads AS (
  SELECT pg_catalog.to_regclass('public.leads')::oid AS relid
), table_evidence AS (
  SELECT l.relid IS NOT NULL AS leads_exists,
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
       WHERE c.oid=l.relid AND x.grantee IN (0,'anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole)
    ) AS no_public_anon_auth_stored_table_acl,
    (SELECT count(*)=1 AND pg_catalog.bool_and(x.privilege_type='SELECT' AND NOT x.is_grantable)
       FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
      WHERE c.oid=l.relid AND x.grantee='service_role'::pg_catalog.regrole) AS service_table_acl_exact,
    NOT EXISTS (
      SELECT 1 FROM (VALUES ('anon'),('authenticated')) r(role_name)
       CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) q(privilege_name)
      WHERE l.relid IS NOT NULL AND pg_catalog.has_table_privilege(r.role_name,l.relid,q.privilege_name)
    ) AS no_anon_auth_effective_table_privileges,
    l.relid IS NOT NULL AND pg_catalog.has_table_privilege('service_role',l.relid,'SELECT')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'UPDATE')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'INSERT')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'DELETE')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'TRUNCATE')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'REFERENCES')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'TRIGGER')
      AND NOT pg_catalog.has_table_privilege('service_role',l.relid,'MAINTAIN') AS service_effective_table_acl_ok
  FROM leads l
), column_evidence AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
    WHERE a.attrelid=COALESCE((SELECT relid FROM leads),0::oid)
      AND a.attnum>0 AND NOT a.attisdropped
      AND x.grantee IN (0,'anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole)
  ) AS no_public_anon_auth_stored_column_acl,
  (SELECT count(*)=5 AND pg_catalog.bool_and(
      a.attname IN ('assigned_to','status','updated_at','priority','notes')
      AND x.privilege_type='UPDATE' AND NOT x.is_grantable)
     FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
    WHERE a.attrelid=COALESCE((SELECT relid FROM leads),0::oid)
      AND a.attnum>0 AND NOT a.attisdropped AND x.grantee='service_role'::pg_catalog.regrole
  ) AS service_column_acl_exact,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    CROSS JOIN (VALUES ('anon'),('authenticated')) r(role_name)
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) q(privilege_name)
    WHERE a.attrelid=COALESCE((SELECT relid FROM leads),0::oid)
      AND a.attnum>0 AND NOT a.attisdropped
      AND pg_catalog.has_column_privilege(r.role_name,a.attrelid,a.attname,q.privilege_name)
  ) AS no_anon_auth_effective_column_privileges
), default_evidence AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
     WHERE d.defaclrole='postgres'::pg_catalog.regrole
       AND d.defaclnamespace=pg_catalog.to_regnamespace('public')::oid
       AND d.defaclobjtype IN ('r','S','f')
       AND (x.grantee IN ('anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole,'service_role'::pg_catalog.regrole)
         OR (d.defaclobjtype IN ('r','S') AND x.grantee=0))
  ) AS postgres_public_defaults_hardened,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
     WHERE d.defaclrole='postgres'::pg_catalog.regrole AND d.defaclnamespace='0'::oid
       AND d.defaclobjtype IN ('r','S','f')
       AND (x.grantee IN ('anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole,'service_role'::pg_catalog.regrole)
         OR (d.defaclobjtype IN ('r','S') AND x.grantee=0)
         OR (d.defaclobjtype='f' AND x.grantee=0 AND x.privilege_type='EXECUTE'))
  ) AS postgres_global_preflight_clear,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
     WHERE d.defaclrole=pg_catalog.to_regrole('supabase_admin')::oid
       AND d.defaclnamespace IN ('0'::oid,pg_catalog.to_regnamespace('public')::oid)
       AND d.defaclobjtype IN ('r','S','f')
       AND (x.grantee IN ('anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole)
         OR (x.grantee=0 AND (d.defaclobjtype IN ('r','S') OR x.privilege_type='EXECUTE')))
  ) AS supabase_admin_api_exposure_defaults_present
), function_130_evidence AS (
  SELECT
    (SELECT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
       FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.initiate_authorized_call(uuid)')::oid) AS initiate_path_ok,
    (SELECT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
       AND p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
       AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),'target_organization_id')>0
       AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),'IS DISTINCT FROM caller_profile.organization_id')>0
       FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.get_telecaller_student_detail(uuid)')::oid) AS detail_function_matches,
    (SELECT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') IS FALSE
       AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') IS TRUE
       FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.get_telecaller_student_detail(uuid)')::oid) AS detail_function_acl_matches,
    (SELECT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
       FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.initiate_authorized_call(uuid)')::oid) AS initiate_authenticated_execute
), function_140_evidence AS (
  SELECT pg_catalog.count(p.oid)=8
     AND pg_catalog.bool_and(COALESCE(
       p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
       AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
       AND pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') IS FALSE
       AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')=t.expected_authenticated
       AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')=t.expected_service,
       false)) AS functions_match,
     pg_catalog.string_agg(t.signature, ', ' ORDER BY t.signature)
       FILTER (WHERE NOT COALESCE(
         p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
         AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
         AND pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') IS FALSE
         AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')=t.expected_authenticated
         AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')=t.expected_service,
         false)) AS mismatched_signatures
  FROM (VALUES
    ('public.begin_caller_phone_enrollment(uuid,uuid,text,text)',false,true),
    ('public.complete_caller_phone_enrollment(uuid,uuid,boolean)',false,true),
    ('public.can_access_call_recording(uuid,uuid)',false,true),
    ('public.can_access_call_recording(uuid)',true,true),
    ('public.can_access_call_recording_path(text)',true,true),
    ('public.get_telecaller_student_detail_legacy(uuid)',false,false),
    ('public.is_caller_active()',true,true),
    ('public.restrict_telecaller_lead_update_columns()',false,true)
  ) t(signature,expected_authenticated,expected_service)
  LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(t.signature)::oid
), final_evidence AS (
  SELECT i.tuple_matches,
         t.leads_exists,
         t.no_public_anon_auth_stored_table_acl,
         t.service_table_acl_exact,
         t.no_anon_auth_effective_table_privileges,
         t.service_effective_table_acl_ok,
         c.no_public_anon_auth_stored_column_acl,
         c.service_column_acl_exact,
         c.no_anon_auth_effective_column_privileges,
         d.postgres_public_defaults_hardened,
         d.postgres_global_preflight_clear,
         d.supabase_admin_api_exposure_defaults_present,
         f130.initiate_path_ok,
         f130.detail_function_matches,
         f130.detail_function_acl_matches,
         f130.initiate_authenticated_execute,
         f140.functions_match,
         f140.mismatched_signatures
    FROM identity_evidence i CROSS JOIN table_evidence t CROSS JOIN column_evidence c
    CROSS JOIN default_evidence d CROSS JOIN function_130_evidence f130 CROSS JOIN function_140_evidence f140
)
SELECT '20261031130000' AS migration_version,
       e.tuple_matches AS database_identity_verified_by_sql_tuple,
        COALESCE((e.leads_exists AND e.no_public_anon_auth_stored_table_acl AND e.service_table_acl_exact
        AND e.no_anon_auth_effective_table_privileges AND e.service_effective_table_acl_ok
        AND e.no_public_anon_auth_stored_column_acl AND e.service_column_acl_exact
        AND e.no_anon_auth_effective_column_privileges AND e.postgres_public_defaults_hardened
        AND e.postgres_global_preflight_clear AND e.initiate_path_ok
         AND e.detail_function_matches AND e.detail_function_acl_matches),false) AS object_state_verified,
       :count_130000::integer AS history_count,
       concat_ws('; ',
         CASE WHEN NOT COALESCE(e.leads_exists,false) THEN 'public.leads is missing' END,
         CASE WHEN NOT COALESCE(e.no_public_anon_auth_stored_table_acl,false) THEN 'unexpected PUBLIC/anon/authenticated stored table ACL exists' END,
         CASE WHEN NOT COALESCE(e.service_table_acl_exact,false) THEN 'service_role stored table ACL differs from SELECT-only target' END,
         CASE WHEN NOT COALESCE(e.no_anon_auth_effective_table_privileges,false) THEN 'anon/authenticated has effective table privilege' END,
         CASE WHEN NOT COALESCE(e.service_effective_table_acl_ok,false) THEN 'service_role effective table ACL differs from target' END,
         CASE WHEN NOT COALESCE(e.no_public_anon_auth_stored_column_acl,false) THEN 'unexpected PUBLIC/anon/authenticated stored column ACL exists' END,
         CASE WHEN NOT COALESCE(e.service_column_acl_exact,false) THEN 'service_role column UPDATE allowlist differs from target' END,
         CASE WHEN NOT COALESCE(e.no_anon_auth_effective_column_privileges,false) THEN 'anon/authenticated has effective column privilege' END,
         CASE WHEN NOT COALESCE(e.postgres_public_defaults_hardened,false) THEN 'postgres public-schema default ACLs are not hardened' END,
         CASE WHEN NOT COALESCE(e.postgres_global_preflight_clear,false) THEN 'postgres global default ACL preflight is not clear' END,
         CASE WHEN e.supabase_admin_api_exposure_defaults_present THEN 'RESIDUAL RISK: supabase_admin global/public default ACLs expose future objects to PUBLIC, anon, or authenticated; migration 130000 only alters postgres defaults' END,
         CASE WHEN NOT COALESCE(e.initiate_path_ok,false) THEN 'initiate_authorized_call search_path differs from target' END,
         CASE WHEN NOT COALESCE(e.detail_function_matches,false) THEN 'get_telecaller_student_detail definition/owner/path differs from target' END,
         CASE WHEN NOT COALESCE(e.detail_function_acl_matches,false) THEN 'get_telecaller_student_detail API EXECUTE grants differ from target' END,
         CASE WHEN e.initiate_authenticated_execute IS FALSE
           THEN 'EXISTING PRIVILEGE DRIFT: initiate_authorized_call authenticated EXECUTE is absent, while migration 20261018000000 grants it; migration 130000 does not change this ACL' END
       ) AS remaining_discrepancies,
       CASE WHEN :'history_is_queryable'::boolean AND :count_130000::integer=1
                   AND e.tuple_matches AND e.leads_exists
                   AND e.no_public_anon_auth_stored_table_acl AND e.service_table_acl_exact
                   AND e.no_anon_auth_effective_table_privileges AND e.service_effective_table_acl_ok
                   AND e.no_public_anon_auth_stored_column_acl AND e.service_column_acl_exact
                   AND e.no_anon_auth_effective_column_privileges AND e.postgres_public_defaults_hardened
                   AND e.postgres_global_preflight_clear AND e.initiate_path_ok
                   AND e.detail_function_matches AND e.detail_function_acl_matches
             THEN 'ALREADY RECORDED; OBJECT STATE MATCHES'
            WHEN :'history_is_queryable'::boolean AND :count_130000::integer=0
                   AND e.tuple_matches AND e.leads_exists
                   AND e.no_public_anon_auth_stored_table_acl AND e.service_table_acl_exact
                   AND e.no_anon_auth_effective_table_privileges AND e.service_effective_table_acl_ok
                   AND e.no_public_anon_auth_stored_column_acl AND e.service_column_acl_exact
                   AND e.no_anon_auth_effective_column_privileges AND e.postgres_public_defaults_hardened
                   AND e.postgres_global_preflight_clear AND e.initiate_path_ok
                   AND e.detail_function_matches AND e.detail_function_acl_matches
            THEN 'CANDIDATE FOR HISTORY-ONLY RECONCILIATION AFTER ADDRESS/CONTAINER IDENTITY MATCH'
            ELSE 'NOT CLEARED: investigate failed or incomplete evidence' END AS reconciliation_eligibility
  FROM final_evidence e
UNION ALL
SELECT '20261031140000',
       e.tuple_matches,
       e.functions_match,
       :count_140000::integer,
       CASE WHEN e.functions_match THEN 'No function definition/path/owner/API EXECUTE discrepancy against the migration target'
            ELSE 'Function discrepancies: ' || COALESCE(e.mismatched_signatures,'catalog state incomplete') END,
       CASE WHEN :'history_is_queryable'::boolean AND :count_140000::integer=1
                   AND e.tuple_matches AND e.functions_match
            THEN 'ALREADY RECORDED; OBJECT STATE MATCHES'
            WHEN :'history_is_queryable'::boolean AND :count_140000::integer=0
                   AND e.tuple_matches AND e.functions_match
            THEN 'CANDIDATE FOR HISTORY-ONLY RECONCILIATION AFTER ADDRESS/CONTAINER IDENTITY MATCH'
            ELSE 'NOT CLEARED: investigate failed or incomplete evidence' END
  FROM (
    SELECT i.tuple_matches, f.functions_match, f.mismatched_signatures
      FROM identity_evidence i CROSS JOIN function_140_evidence f
  ) e;
