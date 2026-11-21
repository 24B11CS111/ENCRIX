-- ENCRIX Production entitlement preflight.
-- Catalog metadata only; this file contains one SELECT statement and reads no customer rows.
-- Verify the Supabase project reference in the dashboard before using its output.

WITH
expected_migrations(version, purpose) AS (
  VALUES
    ('20261001000000', 'base organizations and profiles'),
    ('20261023000000', 'billing foundation tables'),
    ('20261030000000', 'billing integrity prerequisite'),
    ('20261031000000', 'onboarding and billing integrity'),
    ('20261031160000', 'chronological predecessor; not a direct entitlement dependency'),
    ('20261031170000', 'atomic Razorpay lifecycle and refund state'),
    ('20261031180000', 'paid entitlement RPC'),
    ('20261104120000', 'founding pilot entitlement extension')
),
history_state AS (
  SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS relation_oid,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
              AND a.attname = 'version' AND a.atttypid = 'pg_catalog.text'::pg_catalog.regtype
              AND a.attnum > 0 AND NOT a.attisdropped
         ) AS usable_version_column
),
history_counts AS (
  SELECT e.version,
         e.purpose,
         h.relation_oid,
         h.usable_version_column,
         CASE WHEN h.relation_oid IS NOT NULL AND h.usable_version_column THEN
           (pg_catalog.xpath(
             '/table/row/recorded_count/text()',
             pg_catalog.query_to_xml(
               'SELECT count(*)::bigint AS recorded_count FROM supabase_migrations.schema_migrations WHERE version = '
               || pg_catalog.quote_literal(e.version),
               TRUE, FALSE, ''
             )
           ))[1]::text::bigint
         END AS recorded_count
    FROM expected_migrations e
    CROSS JOIN history_state h
),
expected_tables(table_name, purpose) AS (
  VALUES
    ('organizations', 'pilot grant foreign-key target'),
    ('profiles', 'pilot grant administrator and actor lookup'),
    ('organization_subscriptions', 'paid entitlement source'),
    ('billing_payments', 'verified captured payment source'),
    ('billing_webhook_events', 'billing foundation companion table'),
    ('organization_pilot_entitlements', 'founding pilot entitlement source'),
    ('organization_pilot_entitlement_events', 'founding pilot audit history')
),
table_catalog AS (
  SELECT e.table_name, e.purpose, c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity
    FROM expected_tables e
    LEFT JOIN pg_catalog.pg_class c
      ON c.oid = pg_catalog.to_regclass('public.' || e.table_name)
),
expected_columns(table_name, column_name, type_name, not_null) AS (
  VALUES
    ('organization_subscriptions','id','uuid',TRUE),
    ('organization_subscriptions','organization_id','uuid',TRUE),
    ('organization_subscriptions','plan_code','text',TRUE),
    ('organization_subscriptions','status','text',TRUE),
    ('organization_subscriptions','entitlement_source','text',TRUE),
    ('organization_subscriptions','is_current','boolean',TRUE),
    ('organization_subscriptions','checkout_idempotency_key','uuid',TRUE),
    ('organization_subscriptions','checkout_creation_status','text',TRUE),
    ('organization_subscriptions','amount_paise','bigint',FALSE),
    ('organization_subscriptions','razorpay_customer_id','text',FALSE),
    ('organization_subscriptions','razorpay_plan_id','text',FALSE),
    ('organization_subscriptions','razorpay_subscription_id','text',FALSE),
    ('organization_subscriptions','razorpay_short_url','text',FALSE),
    ('organization_subscriptions','current_period_start','timestamp with time zone',FALSE),
    ('organization_subscriptions','current_period_end','timestamp with time zone',FALSE),
    ('organization_subscriptions','cancel_at_period_end','boolean',TRUE),
    ('organization_subscriptions','cancelled_at','timestamp with time zone',FALSE),
    ('organization_subscriptions','ended_at','timestamp with time zone',FALSE),
    ('organization_subscriptions','last_payment_at','timestamp with time zone',FALSE),
    ('organization_subscriptions','created_at','timestamp with time zone',TRUE),
    ('organization_subscriptions','updated_at','timestamp with time zone',TRUE),
    ('organization_subscriptions','razorpay_total_count','integer',FALSE),
    ('billing_payments','id','uuid',TRUE),
    ('billing_payments','organization_id','uuid',TRUE),
    ('billing_payments','subscription_id','uuid',FALSE),
    ('billing_payments','provider','text',TRUE),
    ('billing_payments','idempotency_key','text',TRUE),
    ('billing_payments','razorpay_order_id','text',FALSE),
    ('billing_payments','razorpay_payment_id','text',FALSE),
    ('billing_payments','razorpay_invoice_id','text',FALSE),
    ('billing_payments','amount_paise','bigint',TRUE),
    ('billing_payments','amount_refunded_paise','bigint',TRUE),
    ('billing_payments','currency','text',TRUE),
    ('billing_payments','status','text',TRUE),
    ('billing_payments','signature_verified_at','timestamp with time zone',FALSE),
    ('billing_payments','paid_at','timestamp with time zone',FALSE),
    ('billing_payments','failed_at','timestamp with time zone',FALSE),
    ('billing_payments','created_at','timestamp with time zone',TRUE),
    ('billing_payments','updated_at','timestamp with time zone',TRUE),
    ('organization_pilot_entitlements','id','uuid',TRUE),
    ('organization_pilot_entitlements','organization_id','uuid',TRUE),
    ('organization_pilot_entitlements','granted_by','uuid',TRUE),
    ('organization_pilot_entitlements','granted_at','timestamp with time zone',TRUE),
    ('organization_pilot_entitlements','expires_at','timestamp with time zone',TRUE),
    ('organization_pilot_entitlements','grant_reason','text',TRUE),
    ('organization_pilot_entitlements','revoked_by','uuid',FALSE),
    ('organization_pilot_entitlements','revoked_at','timestamp with time zone',FALSE),
    ('organization_pilot_entitlements','revoke_reason','text',FALSE),
    ('organization_pilot_entitlement_events','id','uuid',TRUE),
    ('organization_pilot_entitlement_events','organization_id','uuid',TRUE),
    ('organization_pilot_entitlement_events','entitlement_id','uuid',TRUE),
    ('organization_pilot_entitlement_events','actor_profile_id','uuid',TRUE),
    ('organization_pilot_entitlement_events','action','text',TRUE),
    ('organization_pilot_entitlement_events','reason','text',TRUE),
    ('organization_pilot_entitlement_events','expires_at','timestamp with time zone',TRUE),
    ('organization_pilot_entitlement_events','occurred_at','timestamp with time zone',TRUE)
),
column_checks AS (
  SELECT e.table_name, e.column_name, e.type_name, e.not_null,
         c.oid AS table_oid, a.attnum,
         CASE WHEN a.attnum IS NOT NULL THEN pg_catalog.format_type(a.atttypid, a.atttypmod) END AS actual_type,
         a.attnotnull AS actual_not_null
    FROM expected_columns e
    LEFT JOIN pg_catalog.pg_class c
      ON c.oid = pg_catalog.to_regclass('public.' || e.table_name)
    LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.oid AND a.attname = e.column_name
     AND a.attnum > 0 AND NOT a.attisdropped
),
expected_constraints(table_name, constraint_name, constraint_type) AS (
  VALUES
    ('organization_subscriptions','organization_subscriptions_pkey','p'),
    ('organization_subscriptions','organization_subscriptions_checkout_idempotency_key_key','u'),
    ('organization_subscriptions','organization_subscriptions_razorpay_subscription_id_key','u'),
    ('organization_subscriptions','organization_subscriptions_period_order','c'),
    ('organization_subscriptions','organization_subscriptions_id_organization_unique','u'),
    ('organization_subscriptions','organization_subscriptions_amount_required','c'),
    ('organization_subscriptions','organization_subscriptions_total_count_positive','c'),
    ('billing_payments','billing_payments_pkey','p'),
    ('billing_payments','billing_payments_idempotency_key_key','u'),
    ('billing_payments','billing_payments_razorpay_payment_id_key','u'),
    ('billing_payments','billing_payments_subscription_organization_fkey','f'),
    ('billing_payments','billing_payments_subscription_required','c'),
    ('billing_payments','billing_payments_status_timestamps','c'),
    ('billing_payments','billing_payments_refund_amount_valid','c'),
    ('billing_payments','billing_payments_refund_status_valid','c'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_pkey','p'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_organization_id_fkey','f'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_granted_by_fkey','f'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_revoked_by_fkey','f'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_expiry_check','c'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_revocation_check','c'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_pkey','p'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_organization_id_fkey','f'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_entitlement_id_fkey','f'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_actor_profile_id_fkey','f'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_action_check','c')
),
constraint_checks AS (
  SELECT e.table_name, e.constraint_name, e.constraint_type,
         c.oid AS table_oid, k.oid AS constraint_oid,
         k.contype, k.convalidated,
         CASE WHEN k.oid IS NOT NULL THEN pg_catalog.pg_get_constraintdef(k.oid, TRUE) END AS definition
    FROM expected_constraints e
    LEFT JOIN pg_catalog.pg_class c
      ON c.oid = pg_catalog.to_regclass('public.' || e.table_name)
    LEFT JOIN pg_catalog.pg_constraint k
      ON k.conrelid = c.oid AND k.conname = e.constraint_name
),
expected_indexes(table_name, index_name, is_unique, key_columns, predicate_kind) AS (
  VALUES
    ('organization_subscriptions','organization_subscriptions_one_current_per_org',TRUE,ARRAY['organization_id']::text[],'is_current'),
    ('organization_subscriptions','organization_subscriptions_status_period_end',FALSE,ARRAY['status','current_period_end']::text[],'none'),
    ('billing_payments','billing_payments_org_created',FALSE,ARRAY['organization_id','created_at']::text[],'none'),
    ('billing_payments','billing_payments_subscription_created',FALSE,ARRAY['subscription_id','created_at']::text[],'none'),
    ('billing_payments','billing_payments_verified_subscription_period',FALSE,ARRAY['subscription_id','paid_at']::text[],'verified_capture'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_active_org_idx',FALSE,ARRAY['organization_id','expires_at']::text[],'not_revoked')
),
index_checks AS (
  SELECT e.table_name, e.index_name, e.is_unique, e.key_columns, e.predicate_kind,
         t.oid AS table_oid, i.indexrelid, i.indisunique, i.indisvalid, i.indisready,
         i.indnkeyatts, i.indnatts,
         (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.pos)
            FROM pg_catalog.generate_series(0, i.indnkeyatts - 1) AS k(pos)
            JOIN pg_catalog.pg_attribute a
              ON a.attrelid = i.indrelid AND a.attnum = i.indkey[k.pos]) AS actual_key_columns,
         CASE WHEN i.indexrelid IS NOT NULL AND i.indpred IS NOT NULL
              THEN pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_expr(i.indpred, i.indrelid), '[[:space:]]+', '', 'g'))
         END AS normalized_predicate,
         CASE WHEN i.indexrelid IS NOT NULL THEN pg_catalog.pg_get_indexdef(i.indexrelid) END AS definition
    FROM expected_indexes e
    LEFT JOIN pg_catalog.pg_class t
      ON t.oid = pg_catalog.to_regclass('public.' || e.table_name)
    LEFT JOIN pg_catalog.pg_class ix
      ON ix.relnamespace = 'public'::pg_catalog.regnamespace AND ix.relname = e.index_name
    LEFT JOIN pg_catalog.pg_index i
      ON i.indexrelid = ix.oid AND i.indrelid = t.oid
),
rpc_targets(rpc_name, signature, return_type, argument_names) AS (
  VALUES
    ('organization_has_active_paid_entitlement', 'public.organization_has_active_paid_entitlement(uuid)', 'boolean', ARRAY['p_organization_id']::text[]),
    ('grant_founding_pilot_entitlement', 'public.grant_founding_pilot_entitlement(uuid,uuid,timestamp with time zone,text)', 'uuid', ARRAY['p_organization_id','p_granted_by','p_expires_at','p_reason']::text[]),
    ('revoke_founding_pilot_entitlement', 'public.revoke_founding_pilot_entitlement(uuid,uuid,uuid,text)', 'boolean', ARRAY['p_organization_id','p_entitlement_id','p_revoked_by','p_reason']::text[])
),
rpc_catalog AS (
  SELECT t.*, pg_catalog.to_regprocedure(t.signature) AS proc_oid
    FROM rpc_targets t
),
rpc_checks AS (
  SELECT r.*, p.prorettype, p.proargnames, p.prosecdef, p.proconfig, p.provolatile,
         pg_catalog.pg_get_function_arguments(p.oid) AS actual_arguments,
         pg_catalog.pg_get_function_result(p.oid) AS actual_return_type,
         pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
         l.lanname AS language_name,
         CASE WHEN p.oid IS NOT NULL THEN pg_catalog.pg_get_functiondef(p.oid) END AS definition,
         sr.oid AS service_role_oid,
         an.oid AS anon_oid,
         au.oid AS authenticated_oid,
         CASE WHEN p.oid IS NOT NULL AND sr.oid IS NOT NULL THEN pg_catalog.has_function_privilege(sr.oid, p.oid, 'EXECUTE') END AS service_role_execute,
         CASE WHEN p.oid IS NOT NULL AND an.oid IS NOT NULL THEN pg_catalog.has_function_privilege(an.oid, p.oid, 'EXECUTE') END AS anon_execute,
         CASE WHEN p.oid IS NOT NULL AND au.oid IS NOT NULL THEN pg_catalog.has_function_privilege(au.oid, p.oid, 'EXECUTE') END AS authenticated_execute,
         CASE WHEN p.oid IS NOT NULL THEN EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
         ) END AS public_execute
    FROM rpc_catalog r
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = r.proc_oid
    LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    LEFT JOIN pg_catalog.pg_roles sr ON sr.rolname = 'service_role'
    LEFT JOIN pg_catalog.pg_roles an ON an.rolname = 'anon'
    LEFT JOIN pg_catalog.pg_roles au ON au.rolname = 'authenticated'
),
policy_targets(table_name, policy_name, expect_service_only) AS (
  VALUES
    ('organization_subscriptions','Service role manages organization subscriptions',TRUE),
    ('billing_payments','Service role manages billing payments',TRUE),
    ('billing_webhook_events','Service role manages billing webhook events',TRUE)
),
policy_checks AS (
  SELECT e.table_name, e.policy_name, e.expect_service_only,
         p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check,
         (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies q
           WHERE q.schemaname = 'public' AND q.tablename = e.table_name) AS policy_count
    FROM policy_targets e
    LEFT JOIN pg_catalog.pg_policies p
      ON p.schemaname = 'public' AND p.tablename = e.table_name AND p.policyname = e.policy_name
),
checks AS (
  SELECT 'DATABASE_IDENTITY'::text AS check_name,
         CASE WHEN current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 THEN 'PASS' ELSE 'FAIL' END AS result,
         current_database()::text || '; ' || current_setting('server_version') || '; user=' || current_user::text AS actual_value,
         'PostgreSQL 17; operator has independently confirmed ENCRIX Production project'::text AS expected_value,
         'Database identity is metadata only; verify the project reference in the Supabase dashboard before acting.'::text AS explanation
  UNION ALL
  SELECT 'TABLE:' || table_name,
         CASE WHEN oid IS NULL THEN 'MISSING' WHEN relkind <> 'r' THEN 'FAIL' ELSE 'PASS' END,
          COALESCE('oid=' || oid::text || '; relkind=' || relkind::text, 'absent'),
         'ordinary table public.' || table_name,
         purpose
    FROM table_catalog
  UNION ALL
  SELECT 'RLS:' || table_name,
         CASE WHEN oid IS NULL THEN 'MISSING' WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN oid IS NULL THEN 'absent' ELSE 'enabled=' || relrowsecurity::text || '; forced=' || relforcerowsecurity::text END,
         'RLS enabled on public.' || table_name,
         purpose
    FROM table_catalog
   WHERE table_name IN ('organization_subscriptions','billing_payments','billing_webhook_events','organization_pilot_entitlements','organization_pilot_entitlement_events')
  UNION ALL
  SELECT 'COLUMN:' || table_name || '.' || column_name,
         CASE WHEN table_oid IS NULL OR attnum IS NULL THEN 'MISSING'
              WHEN actual_type = type_name AND actual_not_null = not_null THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN table_oid IS NULL THEN 'table absent'
              WHEN attnum IS NULL THEN 'column absent'
              ELSE actual_type || '; not_null=' || actual_not_null::text END,
         type_name || '; not_null=' || not_null::text,
         'Required by the entitlement function, billing chain, or founding pilot schema.'
    FROM column_checks
  UNION ALL
  SELECT 'CONSTRAINT:' || table_name || '.' || constraint_name,
         CASE WHEN table_oid IS NULL OR constraint_oid IS NULL THEN 'MISSING'
              WHEN contype = constraint_type AND convalidated THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(definition, 'table or constraint absent'),
         'type=' || constraint_type || '; validated=true',
         'Named schema invariant from the billing or pilot migrations.'
    FROM constraint_checks
  UNION ALL
  SELECT 'INDEX:' || table_name || '.' || index_name,
         CASE WHEN table_oid IS NULL OR indexrelid IS NULL THEN 'MISSING'
              WHEN indisvalid AND indisready AND indisunique = is_unique
               AND actual_key_columns = key_columns
               AND ((predicate_kind = 'none' AND normalized_predicate IS NULL)
                 OR (predicate_kind = 'is_current' AND normalized_predicate = 'is_current')
                 OR (predicate_kind = 'not_revoked' AND normalized_predicate = 'revoked_atisnull')
                 OR (predicate_kind = 'verified_capture' AND normalized_predicate LIKE '%status=''captured''%' AND normalized_predicate LIKE '%signature_verified_atisnotnull%'))
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(definition, 'table or index absent'),
         'valid index; keys=' || array_to_string(key_columns, ',') || '; unique=' || is_unique::text || '; predicate=' || predicate_kind,
         'Index metadata is checked without scanning or returning table rows.'
    FROM index_checks
  UNION ALL
  SELECT 'RPC_SIGNATURE:' || rpc_name,
         CASE WHEN proc_oid IS NULL THEN 'MISSING'
              WHEN proargnames = argument_names AND actual_return_type = return_type THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(actual_arguments || ' returns ' || actual_return_type, 'function absent'),
         signature || ' returns ' || return_type,
         'Exact argument types, names, and result type used by server callers.'
    FROM rpc_checks
  UNION ALL
  SELECT 'RPC_SECURITY:' || rpc_name,
         CASE WHEN proc_oid IS NULL THEN 'MISSING'
              WHEN prosecdef AND language_name IN ('sql','plpgsql')
               AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[] THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN proc_oid IS NULL THEN 'function absent'
              ELSE 'security_definer=' || prosecdef::text || '; language=' || language_name || '; settings=' || COALESCE(proconfig::text, '[]') || '; owner=' || function_owner::text END,
         'SECURITY DEFINER; search_path=pg_catalog, pg_temp',
         'Restricted search_path plus qualified application objects limits name-resolution risks.'
    FROM rpc_checks
  UNION ALL
  SELECT 'RPC_EXECUTE:' || rpc_name,
         CASE WHEN proc_oid IS NULL THEN 'MISSING'
              WHEN service_role_oid IS NULL OR anon_oid IS NULL OR authenticated_oid IS NULL THEN 'FAIL'
              WHEN service_role_execute AND NOT anon_execute AND NOT authenticated_execute AND NOT public_execute THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN proc_oid IS NULL THEN 'function absent'
              ELSE 'service_role=' || COALESCE(service_role_execute::text,'role absent') || '; anon=' || COALESCE(anon_execute::text,'role absent') || '; authenticated=' || COALESCE(authenticated_execute::text,'role absent') || '; public=' || public_execute::text END,
         'service_role=true; anon=false; authenticated=false; PUBLIC=false',
         'Effective role rights and the stored PUBLIC execute entry are checked.'
    FROM rpc_checks
  UNION ALL
  SELECT 'RPC_DEFINITION:' || rpc_name,
         CASE WHEN proc_oid IS NULL THEN 'MISSING' ELSE 'PASS' END,
         COALESCE(definition, 'function absent'),
         'Review actual definition against the intended migration before approving any repair.',
         'Catalog definition only; no function is called.'
    FROM rpc_checks
   WHERE rpc_name = 'organization_has_active_paid_entitlement'
  UNION ALL
  SELECT 'POLICY:' || table_name || '.' || policy_name,
         CASE WHEN policy_count = 0 THEN 'MISSING'
              WHEN policy_count = 1 AND policyname = policy_name AND permissive = 'PERMISSIVE'
               AND roles = ARRAY['service_role']::name[] AND cmd = 'ALL'
               AND qual = 'true' AND with_check = 'true' THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN policyname IS NULL THEN 'expected policy absent; count=' || policy_count::text
              ELSE 'count=' || policy_count::text || '; roles=' || roles::text || '; cmd=' || cmd || '; using=' || COALESCE(qual,'<null>') || '; check=' || COALESCE(with_check,'<null>') END,
         'one permissive service_role ALL policy using true and checking true',
         'Expected server-only RLS policy from the billing foundation.'
    FROM policy_checks
  UNION ALL
  SELECT 'POLICY:organization_pilot_entitlements:client_access',
         CASE WHEN policy_count = 0 THEN 'PASS' ELSE 'FAIL' END,
         'policy_count=' || policy_count::text,
         'zero client-facing policies; service functions own access',
         'Pilot tables have RLS enabled and the migration defines no table policies.'
    FROM (SELECT pg_catalog.count(*) AS policy_count FROM pg_catalog.pg_policies
           WHERE schemaname='public' AND tablename IN ('organization_pilot_entitlements','organization_pilot_entitlement_events')) pilot_policy_count
  UNION ALL
  SELECT 'MIGRATION_HISTORY:' || version,
         CASE WHEN relation_oid IS NULL OR NOT usable_version_column THEN 'MISSING'
              WHEN recorded_count = 1 THEN 'PASS'
              WHEN recorded_count = 0 THEN 'MISSING' ELSE 'FAIL' END,
         CASE WHEN relation_oid IS NULL THEN 'history relation absent'
              WHEN NOT usable_version_column THEN 'text version column absent'
              ELSE 'recorded_count=' || recorded_count::text END,
         'exactly one row for ' || version || ' (' || purpose || ')',
         'History is queried only; a history row alone is not proof that schema effects are correct.'
    FROM history_counts
)
SELECT check_name, result, actual_value, expected_value, explanation
  FROM checks
 ORDER BY check_name;
