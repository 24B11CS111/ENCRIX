-- ENCRIX Production billing preflight: tables.
-- Read-only catalog SELECTs. Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr.
SELECT 'TABLES' AS section,
       expected.table_name,
       COALESCE(c.relkind::text, 'MISSING') AS relkind,
       CASE WHEN c.oid IS NULL THEN 'MISSING'
            WHEN c.relkind IN ('r', 'p') THEN 'PRESENT'
            ELSE 'CONFLICT' END AS result
FROM (VALUES
  ('organizations'), ('profiles'), ('pending_registrations'),
  ('organization_subscriptions'), ('billing_payments'), ('billing_webhook_events'),
  ('registration_otp_attempts'), ('organization_pilot_entitlements'),
  ('organization_pilot_entitlement_events')
) AS expected(table_name)
LEFT JOIN pg_catalog.pg_class AS c
  ON c.relnamespace = 'public'::regnamespace AND c.relname = expected.table_name
ORDER BY expected.table_name;
