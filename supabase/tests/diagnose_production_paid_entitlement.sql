-- READ ONLY: diagnose the paid-entitlement RPC used by owner lead imports.
-- Run with psql (this file uses psql conditionals for an optional migration
-- history table). No customer rows are selected and no SQL writes are issued.

\echo 'DATABASE_IDENTITY'
SELECT current_database() AS database_name,
       current_user AS connected_role,
       session_user AS session_role,
       version() AS postgres_version,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port;

\echo 'MIGRATION_HISTORY_TABLE'
SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
            THEN 'true' ELSE 'false' END AS history_table_exists \gset
\if :history_table_exists
  WITH expected(version) AS (
    VALUES ('20261023000000'), ('20261031000000'), ('20261031170000'), ('20261031180000')
  )
  SELECT e.version, count(m.version) AS recorded_count
  FROM expected AS e
  LEFT JOIN supabase_migrations.schema_migrations AS m ON m.version = e.version
  GROUP BY e.version
  ORDER BY e.version;
\else
  SELECT 'supabase_migrations.schema_migrations is absent' AS finding;
\endif

\echo 'REQUIRED_TABLES_AND_RLS'
WITH expected(table_name) AS (
  VALUES ('organization_subscriptions'), ('billing_payments')
)
SELECT e.table_name,
       c.oid IS NOT NULL AS object_exists,
       CASE WHEN c.oid IS NOT NULL THEN c.relrowsecurity END AS rls_enabled,
       CASE WHEN c.oid IS NOT NULL THEN c.relforcerowsecurity END AS rls_forced,
       CASE WHEN c.oid IS NOT NULL THEN c.relacl END AS stored_acl
FROM expected AS e
LEFT JOIN pg_class AS c
  ON c.oid = pg_catalog.to_regclass('public.' || e.table_name)
ORDER BY e.table_name;

\echo 'REQUIRED_COLUMNS'
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
       CASE WHEN a.attnum IS NOT NULL THEN pg_catalog.format_type(a.atttypid, a.atttypmod) END AS actual_type,
       CASE WHEN a.attnum IS NOT NULL THEN NOT a.attnotnull END AS nullable,
       a.attnum IS NOT NULL AS column_exists
FROM expected AS e
LEFT JOIN pg_class AS c
  ON c.oid = pg_catalog.to_regclass('public.' || e.table_name)
LEFT JOIN pg_attribute AS a
  ON a.attrelid = c.oid
 AND a.attname = e.column_name
 AND a.attnum > 0
 AND NOT a.attisdropped
ORDER BY e.table_name, e.column_name;

\echo 'ENTITLEMENT_FUNCTION_DEFINITION_AND_SECURITY'
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
LEFT JOIN pg_proc AS p ON p.oid = t.oid;

\echo 'EFFECTIVE_TABLE_PRIVILEGES'
WITH target_tables AS (
  SELECT unnest(ARRAY[
    pg_catalog.to_regclass('public.organization_subscriptions'),
    pg_catalog.to_regclass('public.billing_payments')
  ]) AS oid
), expected_roles(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role'), ('postgres'), ('supabase_admin')
)
SELECT c.relname AS table_name,
       er.role_name,
       r.oid IS NOT NULL AS role_exists,
       CASE WHEN c.oid IS NOT NULL AND r.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'SELECT') END AS can_select,
       CASE WHEN c.oid IS NOT NULL AND r.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'INSERT') END AS can_insert,
       CASE WHEN c.oid IS NOT NULL AND r.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'UPDATE') END AS can_update,
       CASE WHEN c.oid IS NOT NULL AND r.oid IS NOT NULL THEN has_table_privilege(r.oid, c.oid, 'DELETE') END AS can_delete
FROM target_tables AS tt
JOIN pg_class AS c ON c.oid = tt.oid
CROSS JOIN expected_roles AS er
LEFT JOIN pg_roles AS r ON r.rolname = er.role_name
ORDER BY c.relname, er.role_name;

\echo 'ENTITLEMENT_FUNCTION_EXECUTE_PRIVILEGES'
WITH target AS (
  SELECT pg_catalog.to_regprocedure('public.organization_has_active_paid_entitlement(uuid)') AS oid
), expected_roles(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role'), ('postgres'), ('supabase_admin')
)
SELECT er.role_name,
       r.oid IS NOT NULL AS role_exists,
       CASE WHEN t.oid IS NOT NULL AND r.oid IS NOT NULL
            THEN has_function_privilege(r.oid, t.oid, 'EXECUTE') END AS can_execute
FROM target AS t
CROSS JOIN expected_roles AS er
LEFT JOIN pg_roles AS r ON r.rolname = er.role_name
ORDER BY er.role_name;

\echo 'ENTITLEMENT_FUNCTION_STORED_ACL_ENTRIES'
SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_proc AS p
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
) AS acl
WHERE p.oid = pg_catalog.to_regprocedure('public.organization_has_active_paid_entitlement(uuid)')
ORDER BY grantee, acl.privilege_type;

\echo 'BILLING_RLS_POLICIES'
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('organization_subscriptions', 'billing_payments')
ORDER BY tablename, policyname;

