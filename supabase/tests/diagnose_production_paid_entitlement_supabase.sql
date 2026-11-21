-- DATABASE IDENTITY
SELECT current_database() AS database_name,
       current_user AS connected_role,
       session_user AS session_role,
       version() AS postgres_version,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port;

-- MIGRATION HISTORY AVAILABILITY AND COUNTS
-- query_to_xml executes only this fixed SELECT and lets the diagnostic report
-- a missing history table/column without referencing it as a static relation.
WITH history_schema AS (
  SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS relation_oid,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_attribute AS a
           WHERE a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
             AND a.attname = 'version'
             AND a.attnum > 0
             AND NOT a.attisdropped
         ) AS has_version_column,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_attribute AS a
           WHERE a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
             AND a.attname = 'version'
             AND a.atttypid = 'pg_catalog.text'::pg_catalog.regtype
             AND a.attnum > 0
             AND NOT a.attisdropped
         ) AS version_column_is_text
)
SELECT CASE
         WHEN relation_oid IS NULL THEN 'MISSING_HISTORY_TABLE'
         WHEN NOT has_version_column THEN 'MISSING_VERSION_COLUMN'
         WHEN NOT version_column_is_text THEN 'INCOMPATIBLE_VERSION_COLUMN_TYPE'
         ELSE 'AVAILABLE'
       END AS history_status,
       CASE
         WHEN relation_oid IS NOT NULL AND has_version_column AND version_column_is_text THEN
           pg_catalog.query_to_xml(
             'WITH expected(version) AS (VALUES ' ||
             '(''20261023000000''), (''20261031000000''), ' ||
             '(''20261031170000''), (''20261031180000'')) ' ||
             'SELECT e.version, count(m.version) AS recorded_count ' ||
             'FROM expected AS e LEFT JOIN supabase_migrations.schema_migrations AS m ' ||
             'ON m.version = e.version GROUP BY e.version ORDER BY e.version',
             TRUE, FALSE, ''
           )::text
         ELSE NULL
       END AS migration_counts_xml
FROM history_schema;

-- BILLING TABLES, RLS, AND STORED TABLE ACLS
WITH expected(table_name) AS (
  VALUES ('organization_subscriptions'), ('billing_payments')
)
SELECT e.table_name,
       c.oid IS NOT NULL AS object_exists,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.relacl AS stored_acl
FROM expected AS e
LEFT JOIN pg_catalog.pg_class AS c
  ON c.oid = pg_catalog.to_regclass('public.' || e.table_name)
ORDER BY e.table_name;

-- ENTITLEMENT RPC REQUIRED COLUMNS AND ACTUAL TYPES
WITH expected(table_name, column_name, type_name) AS (
  VALUES
    ('organization_subscriptions', 'id', 'uuid'),
    ('organization_subscriptions', 'organization_id', 'uuid'),
    ('organization_subscriptions', 'plan_code', 'text'),
    ('organization_subscriptions', 'amount_paise', 'bigint'),
    ('organization_subscriptions', 'entitlement_source', 'text'),
    ('organization_subscriptions', 'status', 'text'),
    ('organization_subscriptions', 'is_current', 'boolean'),
    ('organization_subscriptions', 'checkout_creation_status', 'text'),
    ('organization_subscriptions', 'razorpay_subscription_id', 'text'),
    ('organization_subscriptions', 'current_period_start', 'timestamp with time zone'),
    ('organization_subscriptions', 'current_period_end', 'timestamp with time zone'),
    ('billing_payments', 'subscription_id', 'uuid'),
    ('billing_payments', 'organization_id', 'uuid'),
    ('billing_payments', 'provider', 'text'),
    ('billing_payments', 'status', 'text'),
    ('billing_payments', 'currency', 'text'),
    ('billing_payments', 'amount_paise', 'bigint'),
    ('billing_payments', 'amount_refunded_paise', 'bigint'),
    ('billing_payments', 'signature_verified_at', 'timestamp with time zone'),
    ('billing_payments', 'paid_at', 'timestamp with time zone')
)
SELECT e.table_name,
       e.column_name,
       e.type_name AS expected_type,
       CASE WHEN a.attnum IS NOT NULL
            THEN pg_catalog.format_type(a.atttypid, a.atttypmod) END AS actual_type,
       CASE WHEN a.attnum IS NOT NULL THEN NOT a.attnotnull END AS nullable,
       a.attnum IS NOT NULL AS column_exists
FROM expected AS e
LEFT JOIN pg_catalog.pg_class AS c
  ON c.oid = pg_catalog.to_regclass('public.' || e.table_name)
LEFT JOIN pg_catalog.pg_attribute AS a
  ON a.attrelid = c.oid
 AND a.attname = e.column_name
 AND a.attnum > 0
 AND NOT a.attisdropped
ORDER BY e.table_name, e.column_name;

-- EFFECTIVE TABLE PRIVILEGES FOR BILLING ROLES
WITH expected_tables(table_name) AS (
  VALUES ('organization_subscriptions'), ('billing_payments')
), expected_roles(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role'), ('postgres'), ('supabase_admin')
)
SELECT et.table_name,
       er.role_name,
       r.oid IS NOT NULL AS role_exists,
       c.oid IS NOT NULL AS table_exists,
       CASE WHEN r.oid IS NOT NULL AND c.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'SELECT') END AS can_select,
       CASE WHEN r.oid IS NOT NULL AND c.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'INSERT') END AS can_insert,
       CASE WHEN r.oid IS NOT NULL AND c.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'UPDATE') END AS can_update,
       CASE WHEN r.oid IS NOT NULL AND c.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'DELETE') END AS can_delete,
       CASE WHEN r.oid IS NOT NULL AND c.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'TRUNCATE') END AS can_truncate,
       CASE WHEN r.oid IS NOT NULL AND c.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'REFERENCES') END AS can_references,
       CASE WHEN r.oid IS NOT NULL AND c.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'TRIGGER') END AS can_trigger
FROM expected_tables AS et
CROSS JOIN expected_roles AS er
LEFT JOIN pg_catalog.pg_roles AS r ON r.rolname = er.role_name
LEFT JOIN pg_catalog.pg_class AS c
  ON c.oid = pg_catalog.to_regclass('public.' || et.table_name)
ORDER BY et.table_name, er.role_name;

-- ENTITLEMENT FUNCTION DEFINITION AND SECURITY METADATA
WITH target AS (
  SELECT pg_catalog.to_regprocedure('public.organization_has_active_paid_entitlement(uuid)') AS oid
)
SELECT t.oid IS NOT NULL AS function_exists,
       CASE WHEN p.oid IS NOT NULL THEN pg_catalog.pg_get_userbyid(p.proowner) END AS owner,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS function_settings,
       p.proacl AS stored_acl,
       CASE WHEN p.oid IS NOT NULL THEN pg_catalog.pg_get_functiondef(p.oid) END AS definition
FROM target AS t
LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = t.oid;

-- EFFECTIVE EXECUTE PRIVILEGES FOR BILLING ROLES
WITH target AS (
  SELECT pg_catalog.to_regprocedure('public.organization_has_active_paid_entitlement(uuid)') AS oid
), expected_roles(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role'), ('postgres'), ('supabase_admin')
)
SELECT er.role_name,
       r.oid IS NOT NULL AS role_exists,
       t.oid IS NOT NULL AS function_exists,
       CASE WHEN t.oid IS NOT NULL AND r.oid IS NOT NULL
            THEN has_function_privilege(r.oid, t.oid, 'EXECUTE') END AS can_execute
FROM target AS t
CROSS JOIN expected_roles AS er
LEFT JOIN pg_catalog.pg_roles AS r ON r.rolname = er.role_name
ORDER BY er.role_name;

-- STORED FUNCTION ACL ENTRIES, INCLUDING PUBLIC
SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_catalog.pg_proc AS p
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
) AS acl
WHERE p.oid = pg_catalog.to_regprocedure('public.organization_has_active_paid_entitlement(uuid)')
ORDER BY grantee, acl.privilege_type;

-- BILLING RLS POLICIES (EMPTY RESULTS MEAN NO POLICIES FOUND)
WITH expected(table_name) AS (
  VALUES ('organization_subscriptions'), ('billing_payments')
)
SELECT e.table_name,
       pg_catalog.to_regclass('public.' || e.table_name) IS NOT NULL AS table_exists,
       p.policyname,
       p.permissive,
       p.roles,
       p.cmd,
       p.qual,
       p.with_check
FROM expected AS e
LEFT JOIN pg_catalog.pg_policies AS p
  ON p.schemaname = 'public'
 AND p.tablename = e.table_name
ORDER BY e.table_name, p.policyname;
