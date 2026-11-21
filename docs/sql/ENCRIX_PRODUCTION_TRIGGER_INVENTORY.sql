-- ENCRIX Production trigger inventory for entitlement/onboarding review.
-- Standalone, read-only PostgreSQL 17 / Supabase SQL Editor query.
-- Confirm the SQL Editor project reference is wrzoqxesffbfirjgotbr.
-- Catalog metadata only; no table rows, secrets, writes, temporary objects,
-- session setup, or trigger execution.
WITH target_tables(table_name) AS (
  VALUES
    ('organizations'),
    ('profiles'),
    ('pending_registrations'),
    ('billing_payments'),
    ('organization_subscriptions')
)
SELECT 'TRIGGERS'::text AS section,
       target.table_name,
       (relation.oid IS NOT NULL) AS table_present,
       trigger_row.tgname AS trigger_name,
       CASE trigger_row.tgenabled
         WHEN 'O' THEN 'ORIGIN'
         WHEN 'D' THEN 'DISABLED'
         WHEN 'R' THEN 'REPLICA'
         WHEN 'A' THEN 'ALWAYS'
         ELSE trigger_row.tgenabled::text
       END AS enabled_state,
       CASE WHEN trigger_row.oid IS NULL THEN NULL
            ELSE pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
       END AS trigger_definition,
       CASE WHEN trigger_function.oid IS NULL THEN NULL
            ELSE trigger_function.oid::regprocedure::text
       END AS associated_function,
       CASE WHEN trigger_function.oid IS NULL THEN NULL
            ELSE pg_catalog.pg_get_userbyid(trigger_function.proowner)
       END AS function_owner,
       trigger_function.prosecdef AS function_security_definer,
       trigger_function.proconfig AS function_settings_search_path,
       CASE WHEN trigger_function.oid IS NULL THEN NULL
            ELSE pg_catalog.pg_get_functiondef(trigger_function.oid)
       END AS function_definition
FROM target_tables AS target
LEFT JOIN pg_catalog.pg_class AS relation
  ON relation.relnamespace = 'public'::regnamespace
 AND relation.relname = target.table_name
 AND relation.relkind IN ('r','p')
LEFT JOIN pg_catalog.pg_trigger AS trigger_row
  ON trigger_row.tgrelid = relation.oid
 AND NOT trigger_row.tgisinternal
LEFT JOIN pg_catalog.pg_proc AS trigger_function
  ON trigger_function.oid = trigger_row.tgfoid
ORDER BY target.table_name, trigger_row.tgname;
