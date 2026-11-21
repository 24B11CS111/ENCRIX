-- ENCRIX billing / entitlement read-only postflight.
-- Run only after a separately approved migration change. Confirm project reference
-- wrzoqxesffbfirjgotbr in the SQL Editor before running. No customer rows are selected.
-- Run alongside the preflight and compare exact function definitions and catalog state.
BEGIN TRANSACTION READ ONLY;

SELECT 'P00_TARGET_CONFIRMATION' AS section,
       'Confirm SQL Editor project reference is wrzoqxesffbfirjgotbr.' AS instruction,
       current_database() AS database_name,
       current_setting('server_version') AS postgres_version;

SELECT 'P01_MIGRATION_HISTORY' AS section,
       expected.version,
       CASE WHEN history.version IS NULL THEN 'NOT_RECORDED' ELSE 'RECORDED' END AS result
FROM (VALUES
  ('20261001000000'), ('20261001000001'), ('20261006000000'), ('20261007000000'),
  ('20261008000000'), ('20261012000000'), ('20261013000000'), ('20261014000000'),
  ('20261015000000'), ('20261018000000'), ('20261019000000'), ('20261020000000'),
  ('20261021000000'), ('20261022000000'), ('20261023000000'), ('20261023120000'),
  ('20261024100000'), ('20261024120000'), ('20261024130000'), ('20261027000000'),
  ('20261028000000'), ('20261030000000'), ('20261030120000'), ('20261031000000'),
  ('20261031120000'), ('20261031130000'), ('20261031140000'), ('20261031150000'),
  ('20261031160000'), ('20261031170000'), ('20261031180000'), ('20261101090000'),
  ('20261101100000'), ('20261104120000')
) AS expected(version)
LEFT JOIN supabase_migrations.schema_migrations AS history
  ON history.version::text = expected.version
ORDER BY expected.version;

-- Required tables and billing columns after the approved change.
SELECT 'P02_TABLES' AS section,
       expected.table_name,
       COALESCE(c.relkind::text, 'MISSING') AS relkind,
       CASE WHEN c.oid IS NULL THEN 'MISSING'
            WHEN c.relkind IN ('r', 'p') THEN 'PRESENT'
            ELSE 'CONFLICT' END AS result
FROM (VALUES
  ('organizations'), ('profiles'), ('pending_registrations'), ('registration_otp_attempts'),
  ('organization_subscriptions'), ('billing_payments'), ('billing_webhook_events'),
  ('organization_pilot_entitlements'), ('organization_pilot_entitlement_events')
) AS expected(table_name)
LEFT JOIN pg_catalog.pg_class AS c
  ON c.relnamespace = 'public'::regnamespace AND c.relname = expected.table_name
ORDER BY expected.table_name;

WITH expected(table_name, column_name) AS (
  VALUES
    ('organizations','business_email'), ('organizations','business_phone'), ('organizations','business_location'), ('organizations','website_url'),
    ('profiles','email'), ('profiles','email_verified'), ('profiles','phone_verified'),
    ('pending_registrations','business_email'), ('pending_registrations','business_phone'), ('pending_registrations','business_location'), ('pending_registrations','website_url'), ('pending_registrations','otp_ticket_id'),
    ('registration_otp_attempts','ticket_id'), ('registration_otp_attempts','email'), ('registration_otp_attempts','otp_hash'), ('registration_otp_attempts','attempts'), ('registration_otp_attempts','verified_at'), ('registration_otp_attempts','consumed_at'), ('registration_otp_attempts','expires_at'),
    ('organization_subscriptions','organization_id'), ('organization_subscriptions','plan_code'), ('organization_subscriptions','status'), ('organization_subscriptions','entitlement_source'), ('organization_subscriptions','is_current'), ('organization_subscriptions','checkout_idempotency_key'), ('organization_subscriptions','checkout_creation_status'), ('organization_subscriptions','amount_paise'), ('organization_subscriptions','razorpay_subscription_id'), ('organization_subscriptions','razorpay_total_count'), ('organization_subscriptions','current_period_start'), ('organization_subscriptions','current_period_end'),
    ('billing_payments','organization_id'), ('billing_payments','subscription_id'), ('billing_payments','provider'), ('billing_payments','idempotency_key'), ('billing_payments','razorpay_payment_id'), ('billing_payments','amount_paise'), ('billing_payments','amount_refunded_paise'), ('billing_payments','currency'), ('billing_payments','status'), ('billing_payments','signature_verified_at'), ('billing_payments','paid_at'), ('billing_payments','failed_at'),
    ('billing_webhook_events','provider_event_id'), ('billing_webhook_events','event_type'), ('billing_webhook_events','payload_sha256'), ('billing_webhook_events','processing_status'), ('billing_webhook_events','received_at'), ('billing_webhook_events','processed_at')
)
SELECT 'P03_COLUMNS' AS section,
       e.table_name,
       e.column_name,
       COALESCE(pg_catalog.format_type(a.atttypid, a.atttypmod), 'MISSING') AS data_type,
       CASE WHEN a.attnotnull THEN 'NO' WHEN a.attnum IS NULL THEN 'UNKNOWN' ELSE 'YES' END AS is_nullable,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
       CASE WHEN a.attnum IS NULL THEN 'FAIL_MISSING' ELSE 'PRESENT_REVIEW_DEFINITION' END AS result
FROM expected AS e
LEFT JOIN pg_catalog.pg_class AS c ON c.relnamespace = 'public'::regnamespace AND c.relname = e.table_name
LEFT JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid AND a.attname = e.column_name AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
ORDER BY e.table_name, e.column_name;

SELECT 'P04_CONSTRAINTS' AS section,
       c.relname AS table_name,
       con.conname AS constraint_name,
       con.contype::text AS constraint_type,
       con.convalidated AS validated,
       pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('organization_subscriptions','billing_payments','billing_webhook_events','registration_otp_attempts','pending_registrations','organizations','profiles')
ORDER BY c.relname, con.conname;

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
  ('constraint','registration_otp_attempts','registration_otp_attempts_pkey'),
  ('constraint','registration_otp_attempts','registration_otp_attempts_attempts_check'),
  ('constraint','pending_registrations','pending_registrations_email_key'),
  ('constraint','organization_pilot_entitlements','organization_pilot_entitlements_expiry_check'),
  ('constraint','organization_pilot_entitlements','organization_pilot_entitlements_revocation_check'),
  ('index','organization_subscriptions','organization_subscriptions_one_current_per_org'),
  ('index','organization_subscriptions','organization_subscriptions_status_period_end'),
  ('index','billing_payments','billing_payments_org_created'),
  ('index','billing_payments','billing_payments_subscription_created'),
  ('index','billing_payments','billing_payments_verified_subscription_period'),
  ('index','profiles','profiles_email_unique_lower'),
  ('index','organizations','organizations_owner_id_unique'),
  ('index','email_otps','email_otps_ticket_id_uidx'),
  ('index','organization_pilot_entitlements','organization_pilot_entitlements_active_org_idx')
)
SELECT 'P04_EXPECTED_OBJECTS' AS section,
       e.object_type,
       e.table_name,
       e.object_name,
       CASE WHEN e.object_type = 'constraint' THEN con.convalidated ELSE idx.indisvalid AND idx.indisready END AS valid,
       CASE WHEN e.object_type = 'constraint' THEN pg_catalog.pg_get_constraintdef(con.oid, true)
            WHEN idx.indexrelid IS NOT NULL THEN pg_catalog.pg_get_indexdef(idx.indexrelid)
            ELSE NULL END AS definition,
       CASE WHEN (e.object_type = 'constraint' AND con.oid IS NOT NULL)
                  OR (e.object_type = 'index' AND idx.indexrelid IS NOT NULL)
            THEN 'PRESENT_COMPARE_DEFINITION' ELSE 'FAIL_MISSING' END AS result
FROM expected AS e
LEFT JOIN pg_catalog.pg_class AS tbl ON tbl.relnamespace = 'public'::regnamespace AND tbl.relname = e.table_name
LEFT JOIN pg_catalog.pg_constraint AS con ON e.object_type = 'constraint' AND con.conrelid = tbl.oid AND con.conname = e.object_name
LEFT JOIN pg_catalog.pg_class AS index_class ON e.object_type = 'index' AND index_class.relnamespace = 'public'::regnamespace AND index_class.relname = e.object_name AND index_class.relkind = 'i'
LEFT JOIN pg_catalog.pg_index AS idx ON idx.indexrelid = index_class.oid AND idx.indrelid = tbl.oid
ORDER BY e.object_type, e.table_name, e.object_name;

SELECT 'P05_INDEXES' AS section, schemaname, tablename, indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('organization_subscriptions','billing_payments','billing_webhook_events','registration_otp_attempts','pending_registrations','organizations','profiles')
ORDER BY tablename, indexname;

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
  ('public.record_registration_otp_failure(uuid,text)')
)
SELECT 'P06_FUNCTIONS' AS section,
       e.signature,
       COALESCE(pg_catalog.pg_get_userbyid(p.proowner), 'MISSING') AS owner,
       COALESCE(pg_catalog.format_type(p.prorettype, NULL), 'MISSING') AS return_type,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS service_role_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
         WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) END AS public_execute_acl,
       CASE WHEN p.oid IS NULL THEN 'FAIL_MISSING' ELSE 'PRESENT_COMPARE_WITH_REVIEWED_MIGRATION' END AS result,
       CASE WHEN p.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_functiondef(p.oid) END AS definition
FROM expected AS e
LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = pg_catalog.to_regprocedure(e.signature)
ORDER BY e.signature;

SELECT 'P07_RLS_POLICIES' AS section,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       pol.polname AS policy_name,
       pol.polcmd::text AS command,
       ARRAY(SELECT CASE WHEN u.role_oid = 0 THEN 'PUBLIC' ELSE r.rolname END
             FROM unnest(pol.polroles) AS u(role_oid)
             LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = u.role_oid) AS roles,
       pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
       pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policy AS pol ON pol.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('organization_subscriptions','billing_payments','billing_webhook_events','organization_pilot_entitlements','organization_pilot_entitlement_events','registration_otp_attempts','pending_registrations','email_otps','phone_otps','organization_invitations','organizations','profiles')
ORDER BY c.relname, pol.polname;

SELECT 'P08_TRIGGERS' AS section,
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
  AND c.relname IN ('billing_payments','organization_subscriptions','organizations','profiles','registration_otp_attempts','pending_registrations')
ORDER BY t.tgname;

SELECT 'P09_TABLE_PRIVILEGES' AS section,
       table_name,
       role_name,
       has_table_privilege(role_name, format('public.%I', table_name), 'SELECT') AS can_select,
       has_table_privilege(role_name, format('public.%I', table_name), 'INSERT') AS can_insert,
       has_table_privilege(role_name, format('public.%I', table_name), 'UPDATE') AS can_update,
       has_table_privilege(role_name, format('public.%I', table_name), 'DELETE') AS can_delete
FROM (VALUES ('organization_subscriptions'),('billing_payments'),('billing_webhook_events'),('organization_pilot_entitlements'),('organization_pilot_entitlement_events'),('registration_otp_attempts'),('pending_registrations'),('email_otps'),('phone_otps'),('organization_invitations')) AS t(table_name)
CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(role_name)
WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL
ORDER BY table_name, role_name;

ROLLBACK;
