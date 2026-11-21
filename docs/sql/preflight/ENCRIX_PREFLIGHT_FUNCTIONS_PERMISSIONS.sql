-- ENCRIX Production billing preflight: RPC definitions/ACLs and effective table privileges.
-- Single read-only SELECT result set. No application RPC is called.
-- Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr.
WITH expected(signature) AS (VALUES
  ('public.protect_billing_payment_identity()'),
  ('public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)'),
  ('public.organization_has_active_paid_entitlement(uuid)'),
  ('public.grant_founding_pilot_entitlement(uuid,uuid,timestamp with time zone,text)'),
  ('public.revoke_founding_pilot_entitlement(uuid,uuid,uuid,text)'),
  ('public.issue_registration_otp_ticket(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)'),
  ('public.get_registration_otp_attempts(uuid,text)'),
  ('public.complete_registration_otp_verification(uuid,text,boolean)'),
  ('public.cancel_registration_otp_ticket(uuid,text)'),
  ('public.create_owner_registration(uuid,text,text,text,text,text,text,text,text,text,text,text,uuid,timestamp with time zone)'),
  -- Migration 20261031000000 drops this legacy signature; presence needs manual review.
  ('public.record_registration_otp_failure(uuid,text)')
), function_results AS (
  SELECT 'FUNCTION'::text AS object_type,
         e.signature::text AS object_name,
         NULL::text AS role_name,
         COALESCE(pg_catalog.pg_get_userbyid(p.proowner), 'MISSING')::text AS owner,
         COALESCE(pg_catalog.format_type(p.prorettype, NULL), 'MISSING')::text AS return_type,
         p.prosecdef AS security_definer,
         p.proconfig::text AS function_settings,
         CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') END AS service_role_execute,
         CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_execute,
         CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_execute,
         CASE WHEN p.oid IS NULL THEN NULL ELSE EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         ) END AS public_execute_acl,
         NULL::boolean AS can_select,
         NULL::boolean AS can_insert,
         NULL::boolean AS can_update,
         NULL::boolean AS can_delete,
         CASE WHEN p.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END::text AS result,
         CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_functiondef(p.oid) END::text AS definition
  FROM expected AS e
  LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(e.signature)
), overload_results AS (
  SELECT 'OVERLOAD'::text AS object_type,
         p.oid::regprocedure::text AS object_name,
         NULL::text AS role_name,
         pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
         pg_catalog.format_type(p.prorettype, NULL)::text AS return_type,
         p.prosecdef AS security_definer,
         p.proconfig::text AS function_settings,
         pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
         pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
         pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
         EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         ) AS public_execute_acl,
         NULL::boolean AS can_select,
         NULL::boolean AS can_insert,
         NULL::boolean AS can_update,
         NULL::boolean AS can_delete,
         'REVIEW_OVERLOAD'::text AS result,
         pg_catalog.pg_get_functiondef(p.oid)::text AS definition
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'protect_billing_payment_identity', 'apply_verified_razorpay_payment',
      'organization_has_active_paid_entitlement', 'grant_founding_pilot_entitlement',
      'revoke_founding_pilot_entitlement', 'issue_registration_otp_ticket',
      'get_registration_otp_attempts', 'complete_registration_otp_verification',
      'cancel_registration_otp_ticket', 'create_owner_registration',
      'record_registration_otp_failure'
    )
    AND NOT EXISTS (
      SELECT 1 FROM expected AS e
      WHERE pg_catalog.to_regprocedure(e.signature) = p.oid
    )
), table_results AS (
  SELECT 'TABLE'::text AS object_type,
         t.table_name::text AS object_name,
         r.role_name::text AS role_name,
         NULL::text AS owner,
         NULL::text AS return_type,
         NULL::boolean AS security_definer,
         NULL::text AS function_settings,
         NULL::boolean AS service_role_execute,
         NULL::boolean AS authenticated_execute,
         NULL::boolean AS anon_execute,
         NULL::boolean AS public_execute_acl,
         pg_catalog.has_table_privilege(r.role_name, format('public.%I', t.table_name), 'SELECT') AS can_select,
         pg_catalog.has_table_privilege(r.role_name, format('public.%I', t.table_name), 'INSERT') AS can_insert,
         pg_catalog.has_table_privilege(r.role_name, format('public.%I', t.table_name), 'UPDATE') AS can_update,
         pg_catalog.has_table_privilege(r.role_name, format('public.%I', t.table_name), 'DELETE') AS can_delete,
         'PRESENT'::text AS result,
         NULL::text AS definition
  FROM (VALUES
    ('organization_subscriptions'), ('billing_payments'), ('billing_webhook_events'),
    ('organization_pilot_entitlements'), ('organization_pilot_entitlement_events')
  ) AS t(table_name)
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
  WHERE pg_catalog.to_regclass(format('public.%I', t.table_name)) IS NOT NULL
)
SELECT 'FUNCTIONS_PERMISSIONS' AS section, * FROM function_results
UNION ALL
SELECT 'FUNCTIONS_PERMISSIONS', * FROM overload_results
UNION ALL
SELECT 'FUNCTIONS_PERMISSIONS', * FROM table_results
ORDER BY object_type, object_name, role_name;
