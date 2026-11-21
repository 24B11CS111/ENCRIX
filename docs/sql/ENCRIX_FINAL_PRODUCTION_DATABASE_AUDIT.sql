-- ENCRIX final Production database security audit.
-- PostgreSQL 17 / Supabase SQL Editor; one standalone read-only SELECT statement.
-- Confirm the SQL Editor is connected to Production project wrzoqxesffbfirjgotbr.
-- Returns catalog metadata only: no application/customer rows, OTP values/hashes,
-- credentials, writes, temporary objects, or application RPC invocations.
-- Function definitions are returned only for the named audit targets below.

WITH
expected_migrations(version, repository_filename) AS (
  VALUES
    ('20261001000000','20261001000000_init_leadvault.sql'),
    ('20261001000001','20261001000001_security_hardening.sql'),
    ('20261006000000','20261006000000_production_telephony_recordings.sql'),
    ('20261007000000','20261007000000_otp_authentication_and_onboarding.sql'),
    ('20261008000000','20261008000000_email_otp_authentication.sql'),
    ('20261012000000','20261012000000_phase17_realtime_crm_telephony.sql'),
    ('20261013000000','20261013000000_phase18_secure_student_details_zero_phone.sql'),
    ('20261014000000','20261014000000_phase20_smart_lead_distribution.sql'),
    ('20261015000000','20261015000000_phase21_smart_follow_up_engine.sql'),
    ('20261018000000','20261018000000_phase22_security_critical_remediation.sql'),
    ('20261019000000','20261019000000_phase22_phone_exposure_remediation.sql'),
    ('20261020000000','20261020000000_phase23_followup_reminder_concurrency.sql'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql'),
    ('20261023000000','20261023000000_billing_foundation.sql'),
    ('20261023120000','20261023120000_secure_caller_enrollment_bridge_persistence.sql'),
    ('20261024100000','20261024100000_phase24_1_security_remediation.sql'),
    ('20261024120000','20261024120000_phase24_3_secure_telecaller_lead_access.sql'),
    ('20261024130000','20261024130000_phase24_7_server_telecaller_leads.sql'),
    ('20261027000000','20261027000000_phase32_realtime_publications.sql'),
    ('20261028000000','20261028000000_phase33_realtime_notifications.sql'),
    ('20261030000000','20261030000000_owner_business_billing_details.sql'),
    ('20261030120000','20261030120000_owner_csv_import_persistence.sql'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql'),
    ('20261031120000','20261031120000_sanitized_lead_refresh_signals.sql'),
    ('20261031130000','20261031130000_public_leads_privilege_hardening.sql'),
    ('20261031140000','20261031140000_security_definer_search_path_hardening.sql'),
    ('20261031150000','20261031150000_durable_email_otp_attempts.sql'),
    ('20261031160000','20261031160000_organization_twilio_calling.sql'),
    ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql'),
    ('20261031180000','20261031180000_paid_subscription_entitlement_gate.sql'),
    ('20261101090000','20261101090000_followup_email_outbox.sql'),
    ('20261101100000','20261101100000_unique_pending_invitations.sql'),
    ('20261104120000','20261104120000_founding_pilot_entitlements.sql'),
    ('20261105130000','20261105130000_razorpay_failed_refund_transition.sql'),
    ('20261105140000','20261105140000_paid_entitlement_provider_identity.sql'),
    ('20261105150000','20261105150000_razorpay_active_subscription_required.sql'),
    ('20261105160000','20261105160000_registration_otp_send_rate_limit.sql'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql'),
    ('20261106100000','20261106100000_admin_refund_management.sql'),
    ('20261107100000','20261107100000_persistent_server_session_revocation.sql'),
    ('20261108100000','20261108100000_prevent_audit_tampering_hardening.sql')
),
audit_functions AS (
  SELECT p.oid, n.nspname, p.proname,
         pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         pg_catalog.pg_get_function_result(p.oid) AS result_type,
         p.proowner, p.prosecdef, p.proconfig, p.proacl,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f','p')
    AND p.proname IN (
      'organization_has_active_paid_entitlement',
      'record_registration_otp_failure',
      'issue_registration_otp_ticket',
      'complete_registration_otp_verification',
      'apply_verified_razorpay_payment',
      'create_owner_registration',
      'get_auth_org_id',
      'get_auth_role',
      'get_auth_profile',
      'is_caller_active',
      'prevent_audit_tampering',
      'issue_email_otp_ticket',
      'cancel_email_otp_ticket',
      'complete_email_otp_verification'
    )
),
audit_rows AS (
  -- RLS status and every policy on all public ordinary/partitioned tables.
  SELECT 'RLS_AND_POLICIES'::text AS section,
         COALESCE(n.nspname || '.' || c.relname, '(no matching relation)')::text AS object_name,
         jsonb_build_object(
           'rls_enabled', c.relrowsecurity,
           'rls_forced', c.relforcerowsecurity,
           'policy_name', pol.polname,
           'command', CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END,
           'roles', CASE WHEN pol.oid IS NULL THEN NULL ELSE ARRAY(
             SELECT CASE WHEN role_entry.role_oid = 0 THEN 'PUBLIC'
                         ELSE COALESCE(role_row.rolname, role_entry.role_oid::text) END
             FROM unnest(pol.polroles) AS role_entry(role_oid)
             LEFT JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_entry.role_oid
           ) END,
           'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
           'with_check', pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
         ) AS details
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_policy AS pol ON pol.polrelid = c.oid
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')

  UNION ALL

  -- Effective table privileges for public tables and standard Supabase API roles.
  SELECT 'TABLE_PRIVILEGES', n.nspname || '.' || c.relname,
         jsonb_build_object(
           'role', role_row.rolname,
           'role_superuser', role_row.rolsuper,
           'role_bypassrls', role_row.rolbypassrls,
           'table_owner', pg_catalog.pg_get_userbyid(c.relowner),
           'role_is_table_owner', role_row.oid = c.relowner,
           'row_security_applies', CASE
             WHEN NOT c.relrowsecurity THEN FALSE
             WHEN role_row.rolsuper OR role_row.rolbypassrls THEN FALSE
             WHEN role_row.oid = c.relowner AND NOT c.relforcerowsecurity THEN FALSE
             ELSE TRUE
           END,
           'select', has_table_privilege(role_row.rolname, c.oid, 'SELECT'),
           'insert', has_table_privilege(role_row.rolname, c.oid, 'INSERT'),
           'update', has_table_privilege(role_row.rolname, c.oid, 'UPDATE'),
           'delete', has_table_privilege(role_row.rolname, c.oid, 'DELETE'),
           'truncate', has_table_privilege(role_row.rolname, c.oid, 'TRUNCATE'),
           'references', has_table_privilege(role_row.rolname, c.oid, 'REFERENCES'),
           'trigger', has_table_privilege(role_row.rolname, c.oid, 'TRIGGER')
         )
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN pg_catalog.pg_roles AS role_row
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    AND role_row.rolname IN ('anon','authenticated','service_role')

  UNION ALL

  -- Public schema privileges and API-role attributes affect RLS interpretation.
  SELECT 'PUBLIC_SCHEMA_AND_ROLE_SECURITY', 'public:' || role_row.rolname,
         jsonb_build_object(
           'role', role_row.rolname,
           'superuser', role_row.rolsuper,
           'bypassrls', role_row.rolbypassrls,
           'inherit', role_row.rolinherit,
           'public_schema_usage', has_schema_privilege(role_row.rolname, 'public', 'USAGE'),
           'public_schema_create', has_schema_privilege(role_row.rolname, 'public', 'CREATE'),
           'schema_acl', ns.nspacl
         )
  FROM pg_catalog.pg_roles AS role_row
  JOIN pg_catalog.pg_namespace AS ns ON ns.nspname = 'public'
  WHERE role_row.rolname IN ('anon','authenticated','service_role')

  UNION ALL

  -- Effective privileges on public sequences.
  SELECT 'SEQUENCE_PRIVILEGES', n.nspname || '.' || c.relname,
         jsonb_build_object(
           'role', role_row.rolname,
           'usage', has_sequence_privilege(role_row.rolname, c.oid, 'USAGE'),
           'select', has_sequence_privilege(role_row.rolname, c.oid, 'SELECT'),
           'update', has_sequence_privilege(role_row.rolname, c.oid, 'UPDATE')
         )
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN pg_catalog.pg_roles AS role_row
  WHERE n.nspname = 'public' AND c.relkind = 'S'
    AND role_row.rolname IN ('anon','authenticated','service_role')

  UNION ALL

  -- Every overload of the requested functions, with ownership, body and effective ACL.
  SELECT 'FUNCTIONS_AND_EXECUTE',
         format('%I.%I(%s)', f.nspname, f.proname, f.identity_arguments),
         jsonb_build_object(
           'owner', pg_catalog.pg_get_userbyid(f.proowner),
           'return_type', f.result_type,
           'security_definer', f.prosecdef,
           'function_settings_search_path', f.proconfig,
           'acl', f.proacl,
           'public_execute', EXISTS (
             SELECT 1
             FROM pg_catalog.aclexplode(COALESCE(
               f.proacl, pg_catalog.acldefault('f', f.proowner)
             )) AS function_acl
             WHERE function_acl.grantee = 0
               AND function_acl.privilege_type = 'EXECUTE'
           ),
           'anon_execute', has_function_privilege('anon', f.oid, 'EXECUTE'),
           'authenticated_execute', has_function_privilege('authenticated', f.oid, 'EXECUTE'),
           'service_role_execute', has_function_privilege('service_role', f.oid, 'EXECUTE'),
           'definition', f.definition
         )
  FROM audit_functions AS f

  UNION ALL

  -- EXECUTE visibility for every public function, without returning unrelated bodies.
  SELECT 'PUBLIC_FUNCTION_EXECUTE_PRIVILEGES',
         format('%I.%I(%s)', n.nspname, p.proname,
                pg_catalog.pg_get_function_identity_arguments(p.oid)),
         jsonb_build_object(
           'owner', pg_catalog.pg_get_userbyid(p.proowner),
           'security_definer', p.prosecdef,
           'function_settings_search_path', p.proconfig,
           'acl', p.proacl,
           'public_execute', EXISTS (
             SELECT 1
             FROM pg_catalog.aclexplode(COALESCE(
               p.proacl, pg_catalog.acldefault('f', p.proowner)
             )) AS function_acl
             WHERE function_acl.grantee = 0
               AND function_acl.privilege_type = 'EXECUTE'
           ),
           'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
           'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE')
         )
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'

  UNION ALL

  -- Default ACLs for every schema, role and object type; definitions contain no row data.
  SELECT 'DEFAULT_PRIVILEGES',
         COALESCE(ns.nspname, '(all schemas)') || ':' || owner_role.rolname || ':' || d.defaclobjtype::text,
         jsonb_build_object(
           'owner_role', owner_role.rolname,
           'schema', ns.nspname,
           'object_type', CASE d.defaclobjtype WHEN 'r' THEN 'TABLES'
             WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS'
             WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' ELSE d.defaclobjtype::text END,
           'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
             ELSE COALESCE(grantee_role.rolname, acl.grantee::text) END,
           'grantor', COALESCE(grantor_role.rolname, acl.grantor::text),
           'privilege', acl.privilege_type,
           'grantable', acl.is_grantable
         )
  FROM pg_catalog.pg_default_acl AS d
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = d.defaclrole
  LEFT JOIN pg_catalog.pg_namespace AS ns ON ns.oid = d.defaclnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
  LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
  LEFT JOIN pg_catalog.pg_roles AS grantor_role ON grantor_role.oid = acl.grantor

  UNION ALL

  -- Requested table trigger inventory, including disabled/replica/always state.
  SELECT 'TRIGGERS', n.nspname || '.' || c.relname,
         jsonb_build_object(
           'trigger_name', t.tgname,
           'enabled_state', CASE t.tgenabled WHEN 'O' THEN 'ORIGIN'
             WHEN 'D' THEN 'DISABLED' WHEN 'R' THEN 'REPLICA'
             WHEN 'A' THEN 'ALWAYS' ELSE t.tgenabled::text END,
           'trigger_definition', pg_catalog.pg_get_triggerdef(t.oid, true),
           'function_signature', p.oid::regprocedure::text,
           'function_owner', pg_catalog.pg_get_userbyid(p.proowner),
           'function_security_definer', p.prosecdef,
           'function_settings', p.proconfig,
           'function_definition', pg_catalog.pg_get_functiondef(p.oid)
         )
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND c.relname IN (
      'organizations','profiles','pending_registrations',
      'billing_payments','organization_subscriptions'
    )

  UNION ALL

  -- email_otps column metadata only. Never selects OTP or customer rows.
  SELECT 'EMAIL_OTP_COLUMNS', 'public.email_otps',
         jsonb_build_object(
           'column_name', a.attname,
           'data_type', pg_catalog.format_type(a.atttypid, a.atttypmod),
           'not_null', a.attnotnull,
           'default_expression', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid),
           'identity', a.attidentity::text,
           'generated', a.attgenerated::text
         )
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relname = 'email_otps'
    AND a.attnum > 0 AND NOT a.attisdropped

  UNION ALL

  -- Exact target ticket-index definition and readiness metadata.
  SELECT 'EMAIL_OTP_TICKET_INDEX', 'public.email_otps_ticket_id_uidx',
         jsonb_build_object(
           'present', i.indexrelid IS NOT NULL,
           'index_definition', pg_catalog.pg_get_indexdef(i.indexrelid),
           'valid', i.indisvalid,
           'ready', i.indisready,
           'unique', i.indisunique,
           'predicate', pg_catalog.pg_get_expr(i.indpred, i.indrelid)
         )
  FROM (SELECT pg_catalog.to_regclass('public.email_otps_ticket_id_uidx')::oid AS index_oid) AS target
  LEFT JOIN pg_catalog.pg_index AS i ON i.indexrelid = target.index_oid

  UNION ALL

  -- Repository version + filename mapped against Supabase migration history.
  SELECT 'MIGRATION_HISTORY', e.version || ':' || e.repository_filename,
         jsonb_build_object(
           'version', e.version,
           'repository_filename', e.repository_filename,
           'recorded_count', count(h.version),
           'status', CASE WHEN count(h.version) = 0 THEN 'NOT_RECORDED'
             WHEN count(h.version) = 1 THEN 'RECORDED' ELSE 'DUPLICATE_HISTORY_VERSION' END
         )
  FROM expected_migrations AS e
  LEFT JOIN supabase_migrations.schema_migrations AS h
    ON h.version::text = e.version
  GROUP BY e.version, e.repository_filename

  UNION ALL

  -- Duplicate versions in history, including any version not in this checkout.
  SELECT 'DUPLICATE_MIGRATION_HISTORY', h.version::text,
         jsonb_build_object('version', h.version::text, 'recorded_count', count(*))
  FROM supabase_migrations.schema_migrations AS h
  GROUP BY h.version
  HAVING count(*) > 1
)
SELECT section, object_name, details
FROM audit_rows
ORDER BY section, object_name, details::text;
