-- ENCRIX Production billing preflight: RLS flags and policy definitions.
-- Read-only catalog SELECT. Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr.
SELECT 'RLS_POLICIES' AS section,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       pol.polname AS policy_name,
       pol.polcmd::text AS command,
       ARRAY(SELECT CASE WHEN u.role_oid = 0 THEN 'PUBLIC' ELSE r.rolname::text END
             FROM unnest(pol.polroles) AS u(role_oid)
             LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = u.role_oid) AS roles,
       pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
       pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policy AS pol ON pol.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('organization_subscriptions','billing_payments','billing_webhook_events','organization_pilot_entitlements','organization_pilot_entitlement_events','organizations','profiles')
ORDER BY c.relname, pol.polname;
