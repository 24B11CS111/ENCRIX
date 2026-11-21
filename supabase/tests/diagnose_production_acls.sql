-- ENCRIX production reconciliation diagnostic section.
-- Standalone SQL Editor script copied from diagnose_all_production_migrations.sql.
-- READ ONLY: catalog SELECTs and fixed catalog-guarded aggregate SELECTs only.
-- No application RPCs or customer/lead/payment/personal row values are returned.

-- Purpose: Stored/effective table and column ACLs, default ACLs, schema and sequence privileges.

-- SECTION 9: Stored/effective ACLs for public relations and columns.
SELECT 'TABLE_ACL' AS section, n.nspname AS schema_name,c.relname AS relation_name,
       c.relacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN ARRAY[
         pg_catalog.has_table_privilege('anon',c.oid,'SELECT'),pg_catalog.has_table_privilege('anon',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('anon',c.oid,'UPDATE'),pg_catalog.has_table_privilege('anon',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('anon',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('anon',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('anon',c.oid,'TRIGGER')] END AS anon_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN ARRAY[
         pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'),pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE'),pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('authenticated',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('authenticated',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('authenticated',c.oid,'TRIGGER')] END AS authenticated_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN ARRAY[
         pg_catalog.has_table_privilege('service_role',c.oid,'SELECT'),pg_catalog.has_table_privilege('service_role',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('service_role',c.oid,'UPDATE'),pg_catalog.has_table_privilege('service_role',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('service_role',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('service_role',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('service_role',c.oid,'TRIGGER')] END AS service_role_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN ARRAY[
         pg_catalog.has_table_privilege('postgres',c.oid,'SELECT'),pg_catalog.has_table_privilege('postgres',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('postgres',c.oid,'UPDATE'),pg_catalog.has_table_privilege('postgres',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('postgres',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('postgres',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('postgres',c.oid,'TRIGGER')] END AS postgres_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN ARRAY[
         pg_catalog.has_table_privilege('supabase_admin',c.oid,'SELECT'),pg_catalog.has_table_privilege('supabase_admin',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('supabase_admin',c.oid,'UPDATE'),pg_catalog.has_table_privilege('supabase_admin',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('supabase_admin',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('supabase_admin',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('supabase_admin',c.oid,'TRIGGER')] END AS supabase_admin_effective_privileges,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN pg_catalog.has_table_privilege('anon',c.oid,'MAINTAIN') END AS anon_maintain,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN pg_catalog.has_table_privilege('authenticated',c.oid,'MAINTAIN') END AS authenticated_maintain,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN pg_catalog.has_table_privilege('service_role',c.oid,'MAINTAIN') END AS service_role_maintain,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN pg_catalog.has_table_privilege('postgres',c.oid,'MAINTAIN') END AS postgres_maintain,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN pg_catalog.has_table_privilege('supabase_admin',c.oid,'MAINTAIN') END AS supabase_admin_maintain,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') ORDER BY c.relname;

SELECT 'COLUMN_ACL' AS section, c.relname AS relation_name,a.attname AS column_name,a.attacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN ARRAY[
         pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'REFERENCES')] END AS anon_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN ARRAY[
         pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'REFERENCES')] END AS authenticated_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN ARRAY[
         pg_catalog.has_column_privilege('service_role',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('service_role',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('service_role',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('service_role',c.oid,a.attnum,'REFERENCES')] END AS service_role_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN ARRAY[
         pg_catalog.has_column_privilege('postgres',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('postgres',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('postgres',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('postgres',c.oid,a.attnum,'REFERENCES')] END AS postgres_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN ARRAY[
         pg_catalog.has_column_privilege('supabase_admin',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('supabase_admin',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('supabase_admin',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('supabase_admin',c.oid,a.attnum,'REFERENCES')] END AS supabase_admin_effective_privileges,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
  AND a.attacl IS NOT NULL ORDER BY c.relname,a.attnum;

SELECT 'DEFAULT_ACL_CATALOG' AS section,
       pg_catalog.pg_get_userbyid(d.defaclrole) AS creator_role,
       CASE WHEN d.defaclnamespace=0 THEN '<GLOBAL>' ELSE n.nspname END AS schema_scope,
       d.defaclobjtype AS object_type, d.defaclacl AS stored_default_acl,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
WHERE d.defaclrole IN (SELECT oid FROM pg_catalog.pg_roles
                       WHERE rolname IN ('postgres','supabase_admin'))
   OR d.defaclnamespace=0
ORDER BY creator_role,schema_scope,object_type;

SELECT 'SCHEMA_ACL' AS section,n.nspname AS schema_name,n.nspacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN ARRAY[
         pg_catalog.has_schema_privilege('anon',n.oid,'USAGE'),pg_catalog.has_schema_privilege('anon',n.oid,'CREATE')] END AS anon_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN ARRAY[
         pg_catalog.has_schema_privilege('authenticated',n.oid,'USAGE'),pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE')] END AS authenticated_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN ARRAY[
         pg_catalog.has_schema_privilege('service_role',n.oid,'USAGE'),pg_catalog.has_schema_privilege('service_role',n.oid,'CREATE')] END AS service_role_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN ARRAY[
         pg_catalog.has_schema_privilege('postgres',n.oid,'USAGE'),pg_catalog.has_schema_privilege('postgres',n.oid,'CREATE')] END AS postgres_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN ARRAY[
         pg_catalog.has_schema_privilege('supabase_admin',n.oid,'USAGE'),pg_catalog.has_schema_privilege('supabase_admin',n.oid,'CREATE')] END AS supabase_admin_effective_privileges,
       'PRESENT'::text AS catalog_classification,'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_namespace n
WHERE n.nspname IN ('public','auth','extensions') ORDER BY n.nspname;

SELECT 'SEQUENCE_ACL' AS section,n.nspname AS schema_name,c.relname AS sequence_name,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,c.relacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN ARRAY[
         pg_catalog.has_sequence_privilege('anon',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('anon',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('anon',c.oid,'UPDATE')] END AS anon_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN ARRAY[
         pg_catalog.has_sequence_privilege('authenticated',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('authenticated',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('authenticated',c.oid,'UPDATE')] END AS authenticated_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN ARRAY[
         pg_catalog.has_sequence_privilege('service_role',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('service_role',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('service_role',c.oid,'UPDATE')] END AS service_role_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN ARRAY[
         pg_catalog.has_sequence_privilege('postgres',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('postgres',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('postgres',c.oid,'UPDATE')] END AS postgres_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN ARRAY[
         pg_catalog.has_sequence_privilege('supabase_admin',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('supabase_admin',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('supabase_admin',c.oid,'UPDATE')] END AS supabase_admin_effective_privileges,
       'PRESENT'::text AS catalog_classification,'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='S' AND n.nspname='public' ORDER BY c.relname;
