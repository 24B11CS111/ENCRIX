-- ENCRIX Production billing preflight: expected columns, types, nullability, defaults.
-- Read-only catalog SELECT. Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr.
WITH expected(table_name, column_name) AS (
  VALUES
    ('organizations','id'), ('organizations','owner_id'), ('organizations','business_email'),
    ('organizations','business_phone'), ('organizations','business_location'), ('organizations','website_url'),
    ('profiles','id'), ('profiles','user_id'), ('profiles','organization_id'), ('profiles','email'), ('profiles','role'), ('profiles','status'),
    ('pending_registrations','id'), ('pending_registrations','email'), ('pending_registrations','otp_ticket_id'), ('pending_registrations','business_email'), ('pending_registrations','business_phone'), ('pending_registrations','business_location'), ('pending_registrations','website_url'),
    ('organization_subscriptions','id'), ('organization_subscriptions','organization_id'), ('organization_subscriptions','plan_code'), ('organization_subscriptions','status'), ('organization_subscriptions','entitlement_source'), ('organization_subscriptions','is_current'), ('organization_subscriptions','checkout_idempotency_key'), ('organization_subscriptions','checkout_creation_status'), ('organization_subscriptions','amount_paise'), ('organization_subscriptions','razorpay_customer_id'), ('organization_subscriptions','razorpay_plan_id'), ('organization_subscriptions','razorpay_subscription_id'), ('organization_subscriptions','razorpay_short_url'), ('organization_subscriptions','razorpay_total_count'), ('organization_subscriptions','current_period_start'), ('organization_subscriptions','current_period_end'), ('organization_subscriptions','cancel_at_period_end'), ('organization_subscriptions','cancelled_at'), ('organization_subscriptions','ended_at'), ('organization_subscriptions','last_payment_at'), ('organization_subscriptions','created_at'), ('organization_subscriptions','updated_at'),
    ('billing_payments','id'), ('billing_payments','organization_id'), ('billing_payments','subscription_id'), ('billing_payments','provider'), ('billing_payments','idempotency_key'), ('billing_payments','razorpay_order_id'), ('billing_payments','razorpay_payment_id'), ('billing_payments','razorpay_invoice_id'), ('billing_payments','amount_paise'), ('billing_payments','amount_refunded_paise'), ('billing_payments','currency'), ('billing_payments','status'), ('billing_payments','signature_verified_at'), ('billing_payments','paid_at'), ('billing_payments','failed_at'), ('billing_payments','created_at'), ('billing_payments','updated_at'),
    ('billing_webhook_events','id'), ('billing_webhook_events','provider'), ('billing_webhook_events','provider_event_id'), ('billing_webhook_events','event_type'), ('billing_webhook_events','payload_sha256'), ('billing_webhook_events','processing_status'), ('billing_webhook_events','received_at'), ('billing_webhook_events','processing_started_at'), ('billing_webhook_events','processed_at')
)
SELECT 'COLUMNS' AS section,
       e.table_name,
       e.column_name,
       COALESCE(pg_catalog.format_type(a.atttypid, a.atttypmod), 'MISSING') AS data_type,
       CASE WHEN a.attnotnull THEN 'NO' WHEN a.attnum IS NULL THEN 'UNKNOWN' ELSE 'YES' END AS is_nullable,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
       CASE WHEN a.attnum IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS result
FROM expected AS e
LEFT JOIN pg_catalog.pg_class AS c ON c.relnamespace = 'public'::regnamespace AND c.relname = e.table_name
LEFT JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid AND a.attname = e.column_name AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
ORDER BY e.table_name, e.column_name;
