-- ENCRIX production reconciliation diagnostic section.
-- Standalone SQL Editor script copied from diagnose_all_production_migrations.sql.
-- READ ONLY: catalog SELECTs and fixed catalog-guarded aggregate SELECTs only.
-- No application RPCs or customer/lead/payment/personal row values are returned.

-- Purpose: Identity, prerequisites, dependency relations, and recorded migration versions.

-- SECTION 1: Database identity. Compare with the approved project out of band.
SELECT 'DATABASE_IDENTITY' AS section,
       current_database() AS database_name,
       current_user AS current_role,
       session_user AS session_role,
       version() AS server_version,
       inet_server_addr()::text AS server_address,
       inet_server_port() AS server_port;

-- SECTION 2: Required Supabase roles, schemas, extensions and publication.
WITH expected(kind, object_name, schema_name) AS (
  VALUES
    ('ROLE','anon',NULL::text), ('ROLE','authenticated',NULL),
    ('ROLE','service_role',NULL), ('SCHEMA','auth',NULL),
    ('SCHEMA','extensions',NULL), ('EXTENSION','uuid-ossp','extensions'),
    ('PUBLICATION','supabase_realtime',NULL)
)
SELECT 'PREREQUISITE' AS section, e.kind, e.object_name,
       CASE e.kind
         WHEN 'ROLE' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=e.object_name) THEN 'PRESENT' ELSE 'MISSING' END
         WHEN 'SCHEMA' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname=e.object_name) THEN 'PRESENT' ELSE 'MISSING' END
         WHEN 'EXTENSION' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_extension x JOIN pg_catalog.pg_namespace n ON n.oid=x.extnamespace WHERE x.extname=e.object_name AND n.nspname=e.schema_name) THEN 'PRESENT' ELSE 'MISSING' END
         WHEN 'PUBLICATION' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_publication p WHERE p.pubname=e.object_name) THEN 'PRESENT' ELSE 'MISSING' END
       END AS classification
FROM expected e
ORDER BY e.kind, e.object_name;

WITH expected(schema_name, relation_name) AS (
  VALUES ('auth','users'),('public','organizations'),('public','profiles'),
         ('public','leads'),('public','lead_assignments'),('public','calls'),
         ('public','follow_ups'),('public','notifications'),('public','activity_logs'),
         ('public','security_events'),('public','organization_invitations'),
         ('public','pending_registrations'),('public','email_otps')
)
SELECT 'DEPENDENCY_RELATION' AS section, schema_name, relation_name,
       CASE WHEN pg_catalog.to_regclass(pg_catalog.format('%I.%I',schema_name,relation_name)) IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS classification
FROM expected ORDER BY schema_name,relation_name;

-- SECTION 3: Migration-history evidence. A missing/incompatible table yields
-- UNKNOWN safely. Only version/count values are returned.
WITH history_shape AS (
  SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS rel,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_attribute a
           WHERE a.attrelid=pg_catalog.to_regclass('supabase_migrations.schema_migrations')
             AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped
         ) AS has_version
), expected(version) AS (
  VALUES ('20261001000000'),('20261001000001'),
    ('20261006000000'),('20261007000000'),('20261008000000'),
    ('20261012000000'),('20261013000000'),('20261014000000'),
    ('20261015000000'),('20261018000000'),('20261019000000'),
    ('20261020000000'),('20261021000000'),('20261022000000'),
    ('20261023000000'),('20261023120000'),('20261024100000'),
    ('20261024120000'),('20261024130000'),('20261027000000'),
    ('20261028000000'),('20261030000000'),('20261030120000'),
    ('20261031000000'),('20261031120000'),('20261031130000'),
    ('20261031140000'),('20261031150000'),('20261031160000'),
    ('20261031170000'),('20261031180000'),('20261101090000'),
    ('20261101100000')
)
SELECT 'MIGRATION_HISTORY' AS section, e.version,
       CASE WHEN h.rel IS NULL OR NOT h.has_version THEN 'UNKNOWN'
            WHEN COALESCE(((pg_catalog.xpath('/table/row/migration_version_count/text()',
                 pg_catalog.query_to_xml(
                   'SELECT count(*) AS migration_version_count FROM supabase_migrations.schema_migrations WHERE version = '
                   || pg_catalog.quote_literal(e.version), true, false, '')))[1])::text,'0')::integer = 0 THEN 'MISSING'
            WHEN COALESCE(((pg_catalog.xpath('/table/row/migration_version_count/text()',
                 pg_catalog.query_to_xml(
                   'SELECT count(*) AS migration_version_count FROM supabase_migrations.schema_migrations WHERE version = '
                   || pg_catalog.quote_literal(e.version), true, false, '')))[1])::text,'0')::integer = 1 THEN 'PRESENT'
            ELSE 'CONFLICTING' END AS classification,
       CASE WHEN h.rel IS NULL OR NOT h.has_version THEN NULL::xml
            ELSE pg_catalog.query_to_xml(
              'SELECT count(*) AS migration_version_count FROM supabase_migrations.schema_migrations WHERE version = '
              || pg_catalog.quote_literal(e.version), true, false, '') END AS version_count_xml
FROM expected e CROSS JOIN history_shape h
ORDER BY e.version;
