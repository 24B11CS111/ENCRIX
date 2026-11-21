-- ENCRIX production reconciliation diagnostic section.
-- Standalone SQL Editor script copied from diagnose_all_production_migrations.sql.
-- READ ONLY: catalog SELECTs and fixed catalog-guarded aggregate SELECTs only.
-- No application RPCs or customer/lead/payment/personal row values are returned.

-- Purpose: Trigger definitions and RLS policy expressions.

-- SECTION 8: Triggers and policies. Expressions are catalog definitions;
-- presence alone does not establish semantic equivalence.
SELECT 'TRIGGER_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, t.tgname AS trigger_name,
       pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
       p.oid::regprocedure::text AS trigger_function,
       t.tgenabled AS enabled_state, pg_catalog.pg_get_triggerdef(t.oid,true) AS definition,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND n.nspname='public' ORDER BY c.relname,t.tgname;

SELECT 'POLICY_CATALOG' AS section, schemaname, tablename, policyname,
       permissive, roles, cmd, qual, with_check,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_policies WHERE schemaname='public'
ORDER BY tablename,policyname;
