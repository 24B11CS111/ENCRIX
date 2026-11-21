-- Read-only ENCRIX billing/onboarding postflight.
-- Before execution, confirm the Supabase SQL Editor targets project
-- wrzoqxesffbfirjgotbr. This script performs catalog and data SELECTs only.
BEGIN TRANSACTION READ ONLY;

WITH expected(table_name) AS (
  VALUES
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
  CASE
    WHEN c.oid IS NULL THEN 'FAIL_MISSING'
    WHEN NOT c.relrowsecurity THEN 'FAIL_RLS_DISABLED'
    ELSE 'PASS'
  END AS result
FROM expected AS e
LEFT JOIN pg_catalog.pg_class AS c
  ON c.relnamespace = 'public'::regnamespace
 AND c.relname = e.table_name
 AND c.relkind IN ('r', 'p')
ORDER BY e.table_name;

WITH expected(function_name) AS (
  VALUES
    ('issue_email_otp_ticket'),
    ('complete_email_otp_verification'),
    ('cancel_email_otp_ticket'),
    ('issue_registration_otp_ticket'),
    ('complete_registration_otp_verification'),
    ('get_registration_otp_attempts'),
    ('cancel_registration_otp_ticket'),
    ('create_owner_registration'),
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
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'NOT DEFINER OR MISSING' END AS definer_mode,
  p.proconfig AS function_settings,
  CASE WHEN p.oid IS NULL THEN 'FAIL_MISSING' ELSE 'PRESENT_REVIEW_GRANTS' END AS result
FROM expected AS e
LEFT JOIN pg_catalog.pg_proc AS p
  ON p.pronamespace = 'public'::regnamespace
 AND p.proname = e.function_name
ORDER BY e.function_name, exact_signature;

SELECT
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
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
    'issue_email_otp_ticket', 'complete_email_otp_verification', 'cancel_email_otp_ticket',
    'issue_registration_otp_ticket', 'complete_registration_otp_verification',
    'get_registration_otp_attempts', 'cancel_registration_otp_ticket',
    'create_owner_registration', 'apply_verified_razorpay_payment',
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
  p.proname AS function_name,
  p.oid::regprocedure::text AS exact_signature,
  pg_catalog.pg_get_functiondef(p.oid) LIKE '%s.razorpay_subscription_id ~ ''^sub_[A-Za-z0-9]+$''%'
    AS entitlement_checks_subscription_id,
  pg_catalog.pg_get_functiondef(p.oid) LIKE '%p.razorpay_payment_id ~ ''^pay_[A-Za-z0-9]+$''%'
    AS entitlement_checks_payment_id,
  pg_catalog.pg_get_functiondef(p.oid) LIKE '%r.entitlement_action=''retain''%'
    AS partial_refund_requires_manual_retain
FROM pg_catalog.pg_proc AS p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'organization_has_active_paid_entitlement'
ORDER BY exact_signature;

WITH expected AS (
  SELECT
    to_regclass('public.registration_otp_attempts') AS table_oid,
    to_regprocedure(
      'public.issue_registration_otp_ticket(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)'
    ) AS function_oid
)
SELECT
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  COALESCE(a.attnotnull, FALSE) AS not_null,
  position('v_send_count >= 5' IN pg_catalog.pg_get_functiondef(p.oid)) > 0
    AS five_send_limit_present,
  CASE
    WHEN e.table_oid IS NULL THEN 'FAIL_TABLE_MISSING'
    WHEN a.attnum IS NULL THEN 'FAIL_CREATED_AT_MISSING'
    WHEN a.atttypid <> 'pg_catalog.timestamptz'::regtype OR NOT a.attnotnull
      THEN 'FAIL_CREATED_AT_TYPE_OR_NULLABILITY'
    WHEN p.oid IS NULL OR position(
      'v_send_count >= 5' IN pg_catalog.pg_get_functiondef(p.oid)
    ) = 0 THEN 'FAIL_SEND_LIMIT_MISSING'
    ELSE 'PASS'
  END AS result
FROM expected AS e
LEFT JOIN pg_catalog.pg_attribute AS a
  ON a.attrelid = e.table_oid
 AND a.attname = 'created_at'
 AND a.attnum > 0
 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = e.function_oid;

SELECT
  p.oid::regprocedure::text AS exact_signature,
  position(
    'p_provider_subscription_status = ''active'' AND v_has_current_period_capture'
    IN pg_catalog.pg_get_functiondef(p.oid)
  ) > 0 AS active_provider_state_required
FROM pg_catalog.pg_proc AS p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'apply_verified_razorpay_payment'
ORDER BY exact_signature;

SELECT
  t.relname AS table_name,
  tr.tgname AS trigger_name,
  tr.tgfoid::regprocedure::text AS trigger_function,
  pg_catalog.pg_get_functiondef(tr.tgfoid) LIKE '%NEW.amount_refunded_paise = NEW.amount_paise%'
    AND pg_catalog.pg_get_functiondef(tr.tgfoid) LIKE '%NEW.signature_verified_at IS NOT NULL%'
    AND pg_catalog.pg_get_functiondef(tr.tgfoid) LIKE '%NEW.paid_at IS NOT NULL%'
    AS failed_to_refunded_requires_verified_full_refund
FROM pg_catalog.pg_trigger AS tr
JOIN pg_catalog.pg_class AS t ON t.oid = tr.tgrelid
WHERE t.relnamespace = 'public'::regnamespace
  AND t.relname = 'billing_payments'
  AND tr.tgname = 'protect_billing_payment_identity'
  AND NOT tr.tgisinternal;

SELECT
  expected.version,
  history.version IS NOT NULL AS recorded,
  history.name AS migration_name
FROM (VALUES
  ('20261023000000'), ('20261030000000'), ('20261031000000'),
  ('20261031170000'), ('20261031180000'), ('20261105130000'),
  ('20261105140000'), ('20261105150000'), ('20261105160000'), ('20261105170000'),
  ('20261106100000'), ('20261107100000')
) AS expected(version)
LEFT JOIN supabase_migrations.schema_migrations AS history
  ON history.version::text = expected.version
ORDER BY expected.version;


-- Aggregate state checks for cancellation/refund workflows; no customer rows.
SELECT
  (SELECT count(*) FROM public.organization_subscriptions
    WHERE cancellation_request_status='scheduled'
      AND (cancel_at_period_end IS NOT TRUE OR cancellation_effective_at IS NULL OR cancellation_requested_at IS NULL))
      AS invalid_scheduled_cancellation_count,
  (SELECT count(*) FROM public.billing_refund_requests r
    LEFT JOIN public.billing_payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id
    WHERE p.id IS NULL OR p.subscription_id IS DISTINCT FROM r.subscription_id
      OR (r.approved_amount_paise IS NOT NULL AND r.approved_amount_paise>r.requested_amount_paise)
      OR (r.status IN ('approved','processing','partially_refunded','refunded','failed') AND
          (r.reviewed_by IS NULL OR r.reviewed_at IS NULL OR r.entitlement_action IS NULL)))
      AS invalid_refund_request_invariant_count,
  (SELECT count(*) FROM public.billing_refund_requests r
    LEFT JOIN public.profiles reviewer ON reviewer.id=r.reviewed_by
    WHERE r.reviewed_by IS NOT NULL AND (reviewer.role<>'ADMIN' OR reviewer.status<>'ACTIVE'))
      AS invalid_refund_reviewer_count;

-- Aggregate anomaly counts only; never return tenant, payment, or subscription rows.
SELECT
  count(*) FILTER (WHERE s.entitlement_source = 'razorpay' AND s.status = 'active' AND (
      s.plan_code <> 'business' OR s.amount_paise <> 999900 OR s.is_current IS NOT TRUE
      OR s.checkout_creation_status <> 'created'
      OR s.razorpay_subscription_id !~ '^sub_[A-Za-z0-9]+$'
      OR s.current_period_start IS NULL OR s.current_period_start > statement_timestamp()
      OR s.current_period_end <= statement_timestamp()
  )) AS invalid_active_subscription_count,
  count(*) FILTER (WHERE p.status = 'captured' AND (
      p.provider <> 'razorpay' OR p.currency <> 'INR' OR p.amount_paise <> s.amount_paise
      OR p.razorpay_payment_id !~ '^pay_[A-Za-z0-9]+$'
      OR p.amount_refunded_paise >= p.amount_paise
      OR p.signature_verified_at IS NULL OR p.paid_at IS NULL
  )) AS invalid_captured_payment_count,
  count(*) FILTER (WHERE s.status = 'active' AND NOT EXISTS (
      SELECT 1 FROM public.billing_payments AS paid
      WHERE paid.subscription_id = s.id
        AND paid.organization_id = s.organization_id
        AND paid.provider = 'razorpay'
        AND paid.razorpay_payment_id ~ '^pay_[A-Za-z0-9]+$'
        AND paid.status = 'captured' AND paid.currency = 'INR'
        AND paid.amount_paise = s.amount_paise
        AND paid.amount_refunded_paise < paid.amount_paise
        AND paid.signature_verified_at IS NOT NULL
        AND paid.paid_at >= s.current_period_start
        AND paid.paid_at < s.current_period_end
  )) AS active_without_valid_current_period_capture_count
FROM public.organization_subscriptions AS s
LEFT JOIN public.billing_payments AS p
  ON p.subscription_id = s.id AND p.organization_id = s.organization_id;

ROLLBACK;
