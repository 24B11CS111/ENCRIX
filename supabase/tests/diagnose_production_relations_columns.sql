-- ENCRIX production reconciliation diagnostic section.
-- Standalone SQL Editor script copied from diagnose_all_production_migrations.sql.
-- READ ONLY: catalog SELECTs and fixed catalog-guarded aggregate SELECTs only.
-- No application RPCs or customer/lead/payment/personal row values are returned.

-- Purpose: Public relation security metadata and column definitions.

-- SECTION 5: Exact public relation and column inventory. This returns schema
-- metadata only; compare definitions with the source migrations.
SELECT 'RELATION_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, c.relkind, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
       c.relreplident AS replica_identity, c.relacl AS stored_acl,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
ORDER BY c.relname;

SELECT 'COLUMN_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, a.attnum AS ordinal_position, a.attname AS column_name,
       pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
       a.attidentity AS identity_kind, a.attgenerated AS generated_kind, a.attacl AS column_acl,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname,a.attnum;
