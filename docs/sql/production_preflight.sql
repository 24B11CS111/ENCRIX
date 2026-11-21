-- Read-only ENCRIX billing/onboarding preflight.
-- Before execution, confirm the Supabase SQL Editor targets project
-- wrzoqxesffbfirjgotbr. This script performs catalog SELECTs only.
BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS database_name,
  current_user AS executing_role,
  current_setting('server_version') AS postgres_version;

WITH expected(table_name) AS (
  VALUES
    ('organizations'),
    ('profiles'),
    ('pending_registrations'),
    ('email_otps'),
    ('organization_subscriptions'),
    ('billing_payments'),
    ('billing_webhook_events'),
    ('registration_otp_attempts'),
    ('billing_refund_requests'),
    ('billing_refund_review_events')
)
SELECT
  e.table_name,
  c.oid IS NOT NULL AS table_exists,
  COALESCE(c.relrowsecurity, FALSE) AS rls_enabled,
  COALESCE(c.relforcerowsecurity, FALSE) AS rls_forced,
  pg_catalog.pg_get_userbyid(c.relowner) AS table_owner
FROM expected AS e
LEFT JOIN pg_catalog.pg_class AS c
  ON c.relnamespace = 'public'::regnamespace
 AND c.relname = e.table_name
 AND c.relkind IN ('r', 'p')
ORDER BY e.table_name;

WITH expected(table_name, column_name) AS (
  VALUES
    ('organizations', 'id'),
    ('organizations', 'name'),
    ('organizations', 'slug'),
    ('organizations', 'industry'),
    ('organizations', 'company_size'),
    ('organizations', 'owner_id'),
    ('organizations', 'status'),
    ('organizations', 'business_email'),
    ('organizations', 'business_phone'),
    ('organizations', 'business_location'),
    ('organizations', 'website_url'),
    ('profiles', 'user_id'),
    ('profiles', 'organization_id'),
    ('profiles', 'full_name'),
    ('profiles', 'email'),
    ('profiles', 'phone'),
    ('profiles', 'email_verified'),
    ('profiles', 'phone_verified'),
    ('profiles', 'role'),
    ('profiles', 'status'),
    ('pending_registrations', 'id'),
    ('pending_registrations', 'phone_number'),
    ('pending_registrations', 'company_name'),
    ('pending_registrations', 'owner_name'),
    ('pending_registrations', 'email'),
    ('pending_registrations', 'industry'),
    ('pending_registrations', 'company_size'),
    ('pending_registrations', 'otp_hash'),
    ('pending_registrations', 'attempts'),
    ('pending_registrations', 'resend_after'),
    ('pending_registrations', 'expires_at'),
    ('pending_registrations', 'otp_ticket_id'),
    ('pending_registrations', 'business_email'),
    ('pending_registrations', 'business_phone'),
    ('pending_registrations', 'business_location'),
    ('pending_registrations', 'website_url'),
    ('pending_registrations', 'created_at'),
    ('email_otps', 'id'),
    ('email_otps', 'ticket_id'),
    ('email_otps', 'email'),
    ('email_otps', 'purpose'),
    ('email_otps', 'otp_hash'),
    ('email_otps', 'attempts'),
    ('email_otps', 'expires_at'),
    ('email_otps', 'resend_after'),
    ('email_otps', 'used'),
    ('email_otps', 'verified_at'),
    ('email_otps', 'created_at'),
    ('organization_subscriptions', 'id'),
    ('organization_subscriptions', 'organization_id'),
    ('organization_subscriptions', 'plan_code'),
    ('organization_subscriptions', 'status'),
    ('organization_subscriptions', 'entitlement_source'),
    ('organization_subscriptions', 'is_current'),
    ('organization_subscriptions', 'checkout_idempotency_key'),
    ('organization_subscriptions', 'checkout_creation_status'),
    ('organization_subscriptions', 'amount_paise'),
    ('organization_subscriptions', 'razorpay_plan_id'),
    ('organization_subscriptions', 'razorpay_total_count'),
    ('organization_subscriptions', 'razorpay_subscription_id'),
    ('organization_subscriptions', 'razorpay_short_url'),
    ('organization_subscriptions', 'current_period_start'),
    ('organization_subscriptions', 'current_period_end'),
    ('organization_subscriptions', 'cancel_at_period_end'),
    ('organization_subscriptions', 'cancellation_request_status'),
    ('organization_subscriptions', 'cancellation_request_id'),
    ('organization_subscriptions', 'cancellation_requested_at'),
    ('organization_subscriptions', 'cancellation_effective_at'),
    ('organization_subscriptions', 'cancellation_provider_status'),
    ('organization_subscriptions', 'cancelled_at'),
    ('organization_subscriptions', 'ended_at'),
    ('organization_subscriptions', 'last_payment_at'),
    ('organization_subscriptions', 'created_at'),
    ('organization_subscriptions', 'updated_at'),
    ('billing_payments', 'id'),
    ('billing_payments', 'organization_id'),
    ('billing_payments', 'subscription_id'),
    ('billing_payments', 'provider'),
    ('billing_payments', 'idempotency_key'),
    ('billing_payments', 'razorpay_order_id'),
    ('billing_payments', 'razorpay_payment_id'),
    ('billing_payments', 'razorpay_invoice_id'),
    ('billing_payments', 'amount_paise'),
    ('billing_payments', 'amount_refunded_paise'),
    ('billing_payments', 'currency'),
    ('billing_payments', 'status'),
    ('billing_payments', 'signature_verified_at'),
    ('billing_payments', 'paid_at'),
    ('billing_payments', 'failed_at'),
    ('billing_payments', 'created_at'),
    ('billing_payments', 'updated_at'),
    ('billing_webhook_events', 'id'),
    ('billing_webhook_events', 'provider'),
    ('billing_webhook_events', 'provider_event_id'),
    ('billing_webhook_events', 'event_type'),
    ('billing_webhook_events', 'payload_sha256'),
    ('billing_webhook_events', 'processing_status'),
    ('billing_webhook_events', 'received_at'),
    ('billing_webhook_events', 'processing_started_at'),
    ('billing_webhook_events', 'processed_at'),
    ('billing_refund_requests', 'organization_id'),
    ('billing_refund_requests', 'subscription_id'),
    ('billing_refund_requests', 'payment_id'),
    ('billing_refund_requests', 'requested_by'),
    ('billing_refund_requests', 'request_idempotency_key'),
    ('billing_refund_requests', 'requested_amount_paise'),
    ('billing_refund_requests', 'approved_amount_paise'),
    ('billing_refund_requests', 'status'),
    ('billing_refund_requests', 'entitlement_action'),
    ('billing_refund_requests', 'reviewed_by'),
    ('billing_refund_requests', 'reviewed_at'),
    ('billing_refund_requests', 'provider_refund_id'),
    ('billing_refund_review_events', 'refund_request_id'),
    ('billing_refund_review_events', 'reviewer_id'),
    ('billing_refund_review_events', 'decision'),
    ('billing_refund_review_events', 'approved_amount_paise'),
    ('billing_refund_review_events', 'entitlement_action'),
    ('registration_otp_attempts', 'ticket_id'),
    ('registration_otp_attempts', 'email'),
    ('registration_otp_attempts', 'otp_hash'),
    ('registration_otp_attempts', 'attempts'),
    ('registration_otp_attempts', 'verified_at'),
    ('registration_otp_attempts', 'consumed_at'),
    ('registration_otp_attempts', 'expires_at'),
    ('registration_otp_attempts', 'created_at')
)
SELECT
  e.table_name,
  e.column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  CASE WHEN a.attnotnull THEN FALSE ELSE TRUE END AS nullable,
  CASE WHEN a.attnum IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS result
FROM expected AS e
LEFT JOIN pg_catalog.pg_class AS c
  ON c.relnamespace = 'public'::regnamespace
 AND c.relname = e.table_name
 AND c.relkind IN ('r', 'p')
LEFT JOIN pg_catalog.pg_attribute AS a
  ON a.attrelid = c.oid
 AND a.attname = e.column_name
 AND a.attnum > 0
 AND NOT a.attisdropped
ORDER BY e.table_name, e.column_name;

WITH duplicate_groups AS (
  SELECT 'profiles.email case-insensitive'::text AS check_name, count(*)::BIGINT AS group_count
  FROM (
    SELECT lower(btrim(email)) AS normalized_key
    FROM public.profiles
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) AS duplicates
  UNION ALL
  SELECT 'organizations.owner_id', count(*)::BIGINT
  FROM (
    SELECT owner_id
    FROM public.organizations
    WHERE owner_id IS NOT NULL
    GROUP BY owner_id
    HAVING count(*) > 1
  ) AS duplicates
  UNION ALL
  SELECT 'pending_registrations.email case-insensitive', count(*)::BIGINT
  FROM (
    SELECT lower(btrim(email)) AS normalized_key
    FROM public.pending_registrations
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) AS duplicates
)
SELECT check_name, group_count
FROM duplicate_groups
ORDER BY check_name;

SELECT
  table_name.relname AS table_name,
  index_name.relname AS index_name,
  index_data.indisunique AS unique_index,
  index_data.indisvalid AS valid,
  index_data.indisready AS ready,
  access_method.amname AS access_method,
  index_data.indnkeyatts AS key_count,
  index_data.indnatts AS attribute_count,
  pg_catalog.pg_get_indexdef(index_name.oid) AS definition
FROM pg_catalog.pg_class AS index_name
JOIN pg_catalog.pg_namespace AS index_schema
  ON index_schema.oid = index_name.relnamespace
LEFT JOIN pg_catalog.pg_index AS index_data ON index_data.indexrelid = index_name.oid
LEFT JOIN pg_catalog.pg_class AS table_name ON table_name.oid = index_data.indrelid
LEFT JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_name.relam
WHERE index_schema.nspname = 'public'
  AND index_name.relname IN (
    'profiles_email_unique_lower',
    'organizations_owner_id_unique',
    'organization_subscriptions_one_current_per_org',
    'billing_payments_verified_subscription_period',
    'registration_otp_attempts_email_created_at_idx',
    'billing_refund_requests_payment_status_idx',
    'billing_refund_requests_org_created_idx',
    'billing_refund_requests_one_open_per_payment_idx',
    'billing_refund_review_events_request_idx'
  )
ORDER BY index_name.relname;

SELECT
  t.relname AS table_name,
  c.conname AS constraint_name,
  c.contype AS constraint_type,
  c.convalidated AS validated,
  c.condeferrable AS deferrable,
  pg_catalog.pg_get_constraintdef(c.oid, TRUE) AS definition
FROM pg_catalog.pg_constraint AS c
JOIN pg_catalog.pg_class AS t ON t.oid = c.conrelid
WHERE t.relnamespace = 'public'::regnamespace
  AND t.relname IN ('organization_subscriptions', 'billing_payments', 'billing_refund_requests', 'billing_refund_review_events')
ORDER BY t.relname, c.conname;

WITH expected(function_name) AS (
  VALUES
    ('issue_email_otp_ticket'),
    ('complete_email_otp_verification'),
    ('cancel_email_otp_ticket'),
    ('create_owner_registration'),
    ('issue_registration_otp_ticket'),
    ('complete_registration_otp_verification'),
    ('get_registration_otp_attempts'),
    ('cancel_registration_otp_ticket'),
    ('apply_verified_razorpay_payment'),
    ('organization_has_active_paid_entitlement'),
    ('request_billing_refund'),
    ('review_billing_refund_request'),
    ('claim_billing_refund_processing'),
    ('record_billing_refund_provider_result'),
    ('reconcile_billing_refund_event'),
    ('begin_subscription_cancellation'),
    ('confirm_subscription_cancellation'),
    ('fail_subscription_cancellation')
)
SELECT
  e.function_name,
  p.oid::regprocedure::text AS exact_signature,
  pg_catalog.pg_get_function_result(p.oid) AS return_type,
  pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
  COALESCE(p.prosecdef, FALSE) AS security_definer,
  p.proconfig AS function_settings,
  CASE WHEN p.oid IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS result
FROM expected AS e
LEFT JOIN pg_catalog.pg_proc AS p
  ON p.pronamespace = 'public'::regnamespace
 AND p.proname = e.function_name
ORDER BY e.function_name, exact_signature;

SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  p.oid::regprocedure::text AS exact_signature,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'issue_email_otp_ticket', 'complete_email_otp_verification', 'cancel_email_otp_ticket',
    'create_owner_registration', 'issue_registration_otp_ticket',
    'complete_registration_otp_verification', 'get_registration_otp_attempts',
    'cancel_registration_otp_ticket', 'apply_verified_razorpay_payment',
    'organization_has_active_paid_entitlement', 'request_billing_refund',
    'review_billing_refund_request', 'claim_billing_refund_processing',
    'record_billing_refund_provider_result', 'reconcile_billing_refund_event',
    'begin_subscription_cancellation', 'confirm_subscription_cancellation',
    'fail_subscription_cancellation'
  )
ORDER BY p.proname, exact_signature;

SELECT
  c.relname AS table_name,
  pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
  pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') AS service_role_select,
  pg_catalog.has_table_privilege('service_role', c.oid, 'INSERT') AS service_role_insert,
  pg_catalog.has_table_privilege('service_role', c.oid, 'UPDATE') AS service_role_update,
  pg_catalog.has_table_privilege('service_role', c.oid, 'DELETE') AS service_role_delete
FROM pg_catalog.pg_class AS c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN (
    'organization_subscriptions', 'billing_payments',
    'billing_webhook_events', 'registration_otp_attempts',
    'billing_refund_requests', 'billing_refund_review_events'
  )
ORDER BY c.relname;

SELECT
  t.relname AS table_name,
  p.polname AS policy_name,
  p.polcmd AS command,
  p.polroles AS role_oids,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
FROM pg_catalog.pg_policy AS p
JOIN pg_catalog.pg_class AS t ON t.oid = p.polrelid
WHERE t.relnamespace = 'public'::regnamespace
  AND t.relname IN (
    'organization_subscriptions', 'billing_payments',
    'billing_webhook_events', 'registration_otp_attempts',
    'billing_refund_requests', 'billing_refund_review_events'
  )
ORDER BY t.relname, p.polname;

SELECT
  t.relname AS table_name,
  tr.tgname AS trigger_name,
  tr.tgenabled AS enabled_mode,
  tr.tgfoid::regprocedure::text AS trigger_function,
  pg_catalog.pg_get_triggerdef(tr.oid, TRUE) AS definition
FROM pg_catalog.pg_trigger AS tr
JOIN pg_catalog.pg_class AS t ON t.oid = tr.tgrelid
WHERE t.relnamespace = 'public'::regnamespace
  AND NOT tr.tgisinternal
  AND t.relname IN ('billing_payments', 'organization_subscriptions')
ORDER BY t.relname, tr.tgname;

SELECT
  expected.version,
  history.version IS NOT NULL AS recorded,
  history.name AS migration_name
FROM (VALUES
  ('20261001000000'), ('20261001000001'), ('20261006000000'),
  ('20261007000000'), ('20261008000000'), ('20261012000000'),
  ('20261013000000'), ('20261014000000'), ('20261015000000'),
  ('20261018000000'), ('20261019000000'), ('20261020000000'),
  ('20261021000000'), ('20261022000000'), ('20261023000000'),
  ('20261023120000'), ('20261024100000'), ('20261024120000'),
  ('20261024130000'), ('20261027000000'), ('20261028000000'),
  ('20261030000000'), ('20261030120000'), ('20261031000000'),
  ('20261031120000'), ('20261031130000'), ('20261031140000'),
  ('20261031150000'), ('20261031160000'), ('20261031170000'),
  ('20261031180000'), ('20261101090000'), ('20261101100000'),
  ('20261104120000'), ('20261105130000'), ('20261105140000'),
  ('20261105150000'), ('20261105160000'), ('20261105170000'), ('20261106100000'),
  ('20261107100000'), ('20261108100000')
) AS expected(version)
LEFT JOIN supabase_migrations.schema_migrations AS history
  ON history.version::text = expected.version
ORDER BY expected.version;

-- Duplicate migration history versions must be reconciled manually.
SELECT version::text AS version, count(*) AS recorded_rows
FROM supabase_migrations.schema_migrations
GROUP BY version
HAVING count(*) > 1
ORDER BY version::text;

-- Required UUID generator extension.
SELECT CASE WHEN to_regprocedure('extensions.uuid_generate_v4()') IS NOT NULL
  THEN 'PASS' ELSE 'FAIL_MISSING' END AS uuid_generate_v4_status;

ROLLBACK;
