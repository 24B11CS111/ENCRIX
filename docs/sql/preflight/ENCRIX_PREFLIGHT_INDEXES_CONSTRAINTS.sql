-- ENCRIX Production billing preflight: all constraints/indexes plus required-name checks.
-- Single read-only SELECT result set. Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr.
WITH expected(object_type, table_name, object_name) AS (VALUES
  ('constraint','organization_subscriptions','organization_subscriptions_plan_code_check'),
  ('constraint','organization_subscriptions','organization_subscriptions_status_check'),
  ('constraint','organization_subscriptions','organization_subscriptions_entitlement_source_check'),
  ('constraint','organization_subscriptions','organization_subscriptions_checkout_creation_status_check'),
  ('constraint','organization_subscriptions','organization_subscriptions_period_order'),
  ('constraint','organization_subscriptions','organization_subscriptions_id_organization_unique'),
  ('constraint','organization_subscriptions','organization_subscriptions_amount_required'),
  ('constraint','organization_subscriptions','organization_subscriptions_total_count_positive'),
  ('constraint','billing_payments','billing_payments_provider_check'),
  ('constraint','billing_payments','billing_payments_amount_paise_check'),
  ('constraint','billing_payments','billing_payments_currency_check'),
  ('constraint','billing_payments','billing_payments_status_check'),
  ('constraint','billing_payments','billing_payments_subscription_organization_fkey'),
  ('constraint','billing_payments','billing_payments_subscription_required'),
  ('constraint','billing_payments','billing_payments_status_timestamps'),
  ('constraint','billing_payments','billing_payments_refund_amount_valid'),
  ('constraint','billing_payments','billing_payments_refund_status_valid'),
  ('constraint','billing_webhook_events','billing_webhook_events_provider_check'),
  ('constraint','billing_webhook_events','billing_webhook_events_payload_sha256_check'),
  ('constraint','billing_webhook_events','billing_webhook_events_processing_status_check'),
  ('constraint','billing_webhook_events','billing_webhook_events_provider_event_unique'),
  ('constraint','organization_pilot_entitlements','organization_pilot_entitlements_expiry_check'),
  ('constraint','organization_pilot_entitlements','organization_pilot_entitlements_revocation_check'),
  ('index','organization_subscriptions','organization_subscriptions_one_current_per_org'),
  ('index','organization_subscriptions','organization_subscriptions_status_period_end'),
  ('index','billing_payments','billing_payments_org_created'),
  ('index','billing_payments','billing_payments_subscription_created'),
  ('index','billing_payments','billing_payments_verified_subscription_period'),
  ('index','profiles','profiles_email_unique_lower'),
  ('index','organizations','organizations_owner_id_unique'),
  ('index','organization_pilot_entitlements','organization_pilot_entitlements_active_org_idx')
), expected_results AS (
  SELECT 'EXPECTED'::text AS source,
         e.object_type::text,
         e.table_name::text,
         e.object_name::text,
         CASE WHEN e.object_type = 'constraint' THEN con.convalidated ELSE idx.indisvalid AND idx.indisready END AS valid,
         CASE WHEN e.object_type = 'constraint' THEN pg_catalog.pg_get_constraintdef(con.oid, true)
              WHEN idx.indexrelid IS NOT NULL THEN pg_catalog.pg_get_indexdef(idx.indexrelid)
              ELSE NULL END AS definition,
         CASE WHEN (e.object_type = 'constraint' AND con.oid IS NOT NULL)
                    OR (e.object_type = 'index' AND idx.indexrelid IS NOT NULL)
              THEN 'PRESENT_COMPARE_DEFINITION' ELSE 'MISSING' END::text AS result
  FROM expected AS e
  LEFT JOIN pg_catalog.pg_class AS tbl ON tbl.relnamespace = 'public'::regnamespace AND tbl.relname = e.table_name
  LEFT JOIN pg_catalog.pg_constraint AS con ON e.object_type = 'constraint' AND con.conrelid = tbl.oid AND con.conname = e.object_name
  LEFT JOIN pg_catalog.pg_class AS index_class ON e.object_type = 'index' AND index_class.relnamespace = 'public'::regnamespace AND index_class.relname = e.object_name AND index_class.relkind = 'i'
  LEFT JOIN pg_catalog.pg_index AS idx ON idx.indexrelid = index_class.oid AND idx.indrelid = tbl.oid
), constraint_inventory AS (
  SELECT 'CATALOG'::text AS source,
         'constraint'::text AS object_type,
         c.relname::text AS table_name,
         con.conname::text AS object_name,
         con.convalidated AS valid,
         pg_catalog.pg_get_constraintdef(con.oid, true) AS definition,
         'PRESENT'::text AS result
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('organization_subscriptions','billing_payments','billing_webhook_events','organizations','profiles','pending_registrations','organization_pilot_entitlements','organization_pilot_entitlement_events')
), index_inventory AS (
  SELECT 'CATALOG'::text AS source,
         'index'::text AS object_type,
         tbl.relname::text AS table_name,
         index_class.relname::text AS object_name,
         (i.indisvalid AND i.indisready) AS valid,
         pg_catalog.pg_get_indexdef(i.indexrelid) AS definition,
         'PRESENT'::text AS result
  FROM pg_catalog.pg_index AS i
  JOIN pg_catalog.pg_class AS index_class ON index_class.oid = i.indexrelid
  JOIN pg_catalog.pg_class AS tbl ON tbl.oid = i.indrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = tbl.relnamespace
  WHERE n.nspname = 'public'
    AND tbl.relname IN ('organization_subscriptions','billing_payments','billing_webhook_events','organizations','profiles','pending_registrations','organization_pilot_entitlements','organization_pilot_entitlement_events')
)
SELECT 'INDEXES_CONSTRAINTS' AS section, * FROM expected_results
UNION ALL
SELECT 'INDEXES_CONSTRAINTS', * FROM constraint_inventory
UNION ALL
SELECT 'INDEXES_CONSTRAINTS', * FROM index_inventory
ORDER BY object_type, table_name, object_name, source;
