-- ENCRIX Production billing preflight: relevant trigger/function definitions.
-- Read-only catalog SELECT. No trigger is fired.
-- Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr.
SELECT 'TRIGGERS' AS section,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       pg_catalog.pg_get_triggerdef(t.oid, true) AS trigger_definition,
       p.oid::regprocedure::text AS trigger_function,
       p.prosecdef AS function_security_definer,
       p.proconfig AS function_settings,
       pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
  AND c.relname IN ('billing_payments','organization_subscriptions','organizations','profiles')
ORDER BY c.relname, t.tgname;
