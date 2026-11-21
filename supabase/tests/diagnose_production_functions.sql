-- ENCRIX Production function reconciliation diagnostic.
-- READ ONLY: catalog-backed SELECT statements only.
-- Function source text is not emitted because an unexpected database
-- definition could contain a hardcoded credential. A body fingerprint is
-- returned instead; compare it locally against reviewed source definitions.
-- No application tables, customer data, OTP values, payment rows or secrets
-- are selected.

-- SECTION 7A: Complete public routine inventory (functions, procedures and
-- window functions), including metadata, effective execute privileges and a
-- source-body fingerprint. PUBLIC execute is reported from the stored/default
-- ACL; the named-role checks report effective privileges (including PUBLIC).
WITH expected(version, migration_file, routine_name, identity_arguments, audit_area) AS (
  VALUES
    ('20261001000001','20261001000001_security_hardening.sql','prevent_audit_tampering','',
      'audit trigger'),
    ('20261001000001','20261001000001_security_hardening.sql','is_caller_active','',
      'active profile'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','protect_profile_privilege_escalation','',
      'privilege escalation trigger'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','grant_platform_admin','uuid',
      'platform admin grant'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','is_active_authenticated_profile','',
      'active profile'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','get_auth_profile','',
      'active profile'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','get_auth_role','',
      'active profile'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','get_auth_org_id','',
      'active profile'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','process_follow_up_reminders_cron','timestamp with time zone, uuid',
      'reminder processor'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','get_telecaller_student_detail','uuid',
      'telecaller lead access'),
    ('20261024120000','20261024120000_phase24_3_secure_telecaller_lead_access.sql','update_assigned_telecaller_lead','uuid, text, text',
      'telecaller lead update'),
    ('20261024130000','20261024130000_phase24_7_server_telecaller_leads.sql','server_get_assigned_telecaller_leads','uuid, uuid, uuid',
      'server telecaller lead read'),
    ('20261024130000','20261024130000_phase24_7_server_telecaller_leads.sql','server_update_assigned_telecaller_lead','uuid, uuid, uuid, uuid, text, text',
      'server telecaller lead update'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','issue_registration_otp_ticket','uuid, text, text, timestamp with time zone, timestamp with time zone, text, text, text, text, text, text, text, text, text',
      'registration OTP issue'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','get_registration_otp_attempts','uuid, text',
      'registration OTP read'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','complete_registration_otp_verification','uuid, text, boolean',
      'registration OTP verify'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','create_owner_registration','uuid, text, text, text, text, text, text, text, text, text, text, text, uuid, timestamp with time zone',
      'owner registration'),
    ('20261031150000','20261031150000_durable_email_otp_attempts.sql','issue_email_otp_ticket','uuid, text, text, text, timestamp with time zone, timestamp with time zone',
      'email OTP issue'),
    ('20261031150000','20261031150000_durable_email_otp_attempts.sql','complete_email_otp_verification','uuid, text, text, boolean',
      'email OTP verify'),
    ('20261031150000','20261031150000_durable_email_otp_attempts.sql','cancel_email_otp_ticket','uuid, text, text',
      'email OTP cancel'),
    ('20261031180000','20261031180000_paid_subscription_entitlement_gate.sql','organization_has_active_paid_entitlement','uuid',
      'paid entitlement'),
    ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql','apply_verified_razorpay_payment','uuid, uuid, text, text, text, bigint, text, text, timestamp with time zone, bigint, integer, text, timestamp with time zone, timestamp with time zone, timestamp with time zone',
      'Razorpay verified payment'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','request_billing_refund','uuid, uuid, uuid, bigint, text, uuid',
      'refund request'),
    ('20261106100000','20261106100000_admin_refund_management.sql','review_billing_refund_request','uuid, uuid, text, bigint, text, text',
      'admin refund review'),
    ('20261106100000','20261106100000_admin_refund_management.sql','claim_billing_refund_processing','uuid, uuid, uuid',
      'refund processing claim'),
    ('20261106100000','20261106100000_admin_refund_management.sql','record_billing_refund_provider_result','uuid, uuid, text, text, uuid',
      'refund provider result'),
    ('20261106100000','20261106100000_admin_refund_management.sql','reconcile_billing_refund_event','uuid, text, text, bigint, text, bigint',
      'refund webhook reconciliation'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','begin_subscription_cancellation','uuid, uuid, uuid',
      'subscription cancellation'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','confirm_subscription_cancellation','uuid, uuid, uuid, text, timestamp with time zone',
      'subscription cancellation'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','fail_subscription_cancellation','uuid, uuid, uuid, text',
      'subscription cancellation'),
    ('20261107100000','20261107100000_persistent_server_session_revocation.sql','is_server_session_revoked','text',
      'server session revocation'),
    ('20261107100000','20261107100000_persistent_server_session_revocation.sql','revoke_server_session','text, timestamp with time zone',
      'server session revocation')
), resolved_expected AS (
  SELECT e.*,
         pg_catalog.to_regprocedure(
           'public.' || e.routine_name || '(' || e.identity_arguments || ')'
         ) AS routine_oid
  FROM expected e
)
SELECT 'FUNCTION_CATALOG' AS section,
       pg_catalog.format('%I.%I(%s)', n.nspname, p.proname,
                         pg_catalog.oidvectortypes(p.proargtypes)) AS exact_signature,
       p.proname AS routine_name,
       CASE p.prokind
         WHEN 'f' THEN 'FUNCTION'
         WHEN 'p' THEN 'PROCEDURE'
         WHEN 'a' THEN 'AGGREGATE'
         WHEN 'w' THEN 'WINDOW FUNCTION'
         ELSE p.prokind::text
       END AS routine_kind,
       pg_catalog.format_type(p.prorettype,NULL) AS return_type,
       l.lanname AS language,
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_mode,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       CASE p.provolatile
         WHEN 'i' THEN 'IMMUTABLE'
         WHEN 's' THEN 'STABLE'
         WHEN 'v' THEN 'VOLATILE'
         ELSE p.provolatile::text
       END AS volatility,
       p.proisstrict AS strict,
       p.proretset AS returns_set,
       p.proparallel AS parallel_safety,
       p.proconfig AS configuration,
       (SELECT pg_catalog.substr(cfg.setting, pg_catalog.length('search_path=') + 1)
          FROM unnest(p.proconfig) AS cfg(setting)
         WHERE cfg.setting LIKE 'search_path=%'
         LIMIT 1) AS search_path,
       p.proacl AS stored_execute_acl,
       EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(p.proacl, pg_catalog.acldefault('f',p.proowner))
           ) AS acl
          WHERE acl.grantee=0::oid AND acl.privilege_type='EXECUTE'
       ) AS public_execute,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon')
         THEN pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
       END AS anon_effective_execute,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated')
         THEN pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
       END AS authenticated_effective_execute,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role')
         THEN pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
       END AS service_role_effective_execute,
       CASE WHEN p.prokind='a' THEN NULL
            ELSE pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))
       END AS definition_md5,
       re.version AS source_migration_version,
       re.migration_file AS source_migration_file,
       re.audit_area,
       CASE WHEN re.routine_oid IS NULL
         THEN 'NOT_IN_FOCUSED_SOURCE_REGISTRY'
         ELSE 'SOURCE_EXPECTED'
       END AS source_mapping
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid=p.prolang
LEFT JOIN resolved_expected re ON re.routine_oid=p.oid
WHERE n.nspname='public' AND p.prokind IN ('f','p','w','a')
ORDER BY p.proname, pg_catalog.oidvectortypes(p.proargtypes);

-- SECTION 7B: Explicitly check focused, source-defined security-sensitive
-- signatures. This returns metadata/presence only; it does not call routines.
WITH expected(version, migration_file, routine_name, identity_arguments, audit_area) AS (
  VALUES
    ('20261001000001','20261001000001_security_hardening.sql','prevent_audit_tampering','',
      'audit trigger'),
    ('20261001000001','20261001000001_security_hardening.sql','is_caller_active','',
      'active profile'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','protect_profile_privilege_escalation','',
      'privilege escalation trigger'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','grant_platform_admin','uuid',
      'platform admin grant'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','is_active_authenticated_profile','',
      'active profile'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','get_auth_profile','',
      'active profile'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','get_auth_role','',
      'active profile'),
    ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','get_auth_org_id','',
      'active profile'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','process_follow_up_reminders_cron','timestamp with time zone, uuid',
      'reminder processor'),
    ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','get_telecaller_student_detail','uuid',
      'telecaller lead access'),
    ('20261024120000','20261024120000_phase24_3_secure_telecaller_lead_access.sql','update_assigned_telecaller_lead','uuid, text, text',
      'telecaller lead update'),
    ('20261024130000','20261024130000_phase24_7_server_telecaller_leads.sql','server_get_assigned_telecaller_leads','uuid, uuid, uuid',
      'server telecaller lead read'),
    ('20261024130000','20261024130000_phase24_7_server_telecaller_leads.sql','server_update_assigned_telecaller_lead','uuid, uuid, uuid, uuid, text, text',
      'server telecaller lead update'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','issue_registration_otp_ticket','uuid, text, text, timestamp with time zone, timestamp with time zone, text, text, text, text, text, text, text, text, text',
      'registration OTP issue'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','get_registration_otp_attempts','uuid, text',
      'registration OTP read'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','complete_registration_otp_verification','uuid, text, boolean',
      'registration OTP verify'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','create_owner_registration','uuid, text, text, text, text, text, text, text, text, text, text, text, uuid, timestamp with time zone',
      'owner registration'),
    ('20261031150000','20261031150000_durable_email_otp_attempts.sql','issue_email_otp_ticket','uuid, text, text, text, timestamp with time zone, timestamp with time zone',
      'email OTP issue'),
    ('20261031150000','20261031150000_durable_email_otp_attempts.sql','complete_email_otp_verification','uuid, text, text, boolean',
      'email OTP verify'),
    ('20261031150000','20261031150000_durable_email_otp_attempts.sql','cancel_email_otp_ticket','uuid, text, text',
      'email OTP cancel'),
    ('20261031180000','20261031180000_paid_subscription_entitlement_gate.sql','organization_has_active_paid_entitlement','uuid',
      'paid entitlement'),
    ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql','apply_verified_razorpay_payment','uuid, uuid, text, text, text, bigint, text, text, timestamp with time zone, bigint, integer, text, timestamp with time zone, timestamp with time zone, timestamp with time zone',
      'Razorpay verified payment'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','request_billing_refund','uuid, uuid, uuid, bigint, text, uuid',
      'refund request'),
    ('20261106100000','20261106100000_admin_refund_management.sql','review_billing_refund_request','uuid, uuid, text, bigint, text, text',
      'admin refund review'),
    ('20261106100000','20261106100000_admin_refund_management.sql','claim_billing_refund_processing','uuid, uuid, uuid',
      'refund processing claim'),
    ('20261106100000','20261106100000_admin_refund_management.sql','record_billing_refund_provider_result','uuid, uuid, text, text, uuid',
      'refund provider result'),
    ('20261106100000','20261106100000_admin_refund_management.sql','reconcile_billing_refund_event','uuid, text, text, bigint, text, bigint',
      'refund webhook reconciliation'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','begin_subscription_cancellation','uuid, uuid, uuid',
      'subscription cancellation'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','confirm_subscription_cancellation','uuid, uuid, uuid, text, timestamp with time zone',
      'subscription cancellation'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','fail_subscription_cancellation','uuid, uuid, uuid, text',
      'subscription cancellation'),
    ('20261107100000','20261107100000_persistent_server_session_revocation.sql','is_server_session_revoked','text',
      'server session revocation'),
    ('20261107100000','20261107100000_persistent_server_session_revocation.sql','revoke_server_session','text, timestamp with time zone',
      'server session revocation')
), resolved AS (
  SELECT e.*,
         pg_catalog.to_regprocedure(
           'public.' || e.routine_name || '(' || e.identity_arguments || ')'
         ) AS routine_oid
  FROM expected e
)
SELECT 'FUNCTION_SOURCE_EXPECTATIONS' AS section,
       version, migration_file, audit_area, routine_name,
       identity_arguments AS expected_identity_arguments,
       CASE WHEN routine_oid IS NULL THEN 'MISSING_EXACT_SIGNATURE'
            ELSE 'PRESENT_EXACT_SIGNATURE'
       END AS catalog_status
FROM resolved
ORDER BY version, routine_name, identity_arguments;
