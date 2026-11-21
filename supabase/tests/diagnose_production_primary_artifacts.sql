-- ENCRIX production reconciliation diagnostic section.
-- Standalone SQL Editor script copied from diagnose_all_production_migrations.sql.
-- READ ONLY: catalog SELECTs and fixed catalog-guarded aggregate SELECTs only.
-- No application RPCs or customer/lead/payment/personal row values are returned.

-- Purpose: Primary migration artifact presence/conflict classification.

-- SECTION 4: Primary migration artifacts. The status here is object-level,
-- not a claim that every effect of a migration is reconciled. Pre-existing
-- relations/functions that migrations alter are marked UNKNOWN by design.
WITH expected(version, migration_file, object_kind, object_name, exact_signature, attribution) AS (
  VALUES
  ('20261006000000','20261006000000_production_telephony_recordings.sql','TABLE','webhook_events',NULL,'created'),
  ('20261007000000','20261007000000_otp_authentication_and_onboarding.sql','TABLE','organization_invitations',NULL,'created'),
  ('20261007000000','20261007000000_otp_authentication_and_onboarding.sql','TABLE','pending_registrations',NULL,'created'),
  ('20261007000000','20261007000000_otp_authentication_and_onboarding.sql','TABLE','phone_otps',NULL,'created'),
  ('20261008000000','20261008000000_email_otp_authentication.sql','TABLE','email_otps',NULL,'created'),
  ('20261012000000','20261012000000_phase17_realtime_crm_telephony.sql','TABLE','call_recordings',NULL,'created'),
  ('20261013000000','20261013000000_phase18_secure_student_details_zero_phone.sql','RELATION','leads',NULL,'altered; added education/detail columns'),
  ('20261014000000','20261014000000_phase20_smart_lead_distribution.sql','TABLE','distribution_configs',NULL,'created'),
  ('20261015000000','20261015000000_phase21_smart_follow_up_engine.sql','RELATION','follow_ups',NULL,'altered; added reminder fields and status constraint'),
  ('20261018000000','20261018000000_phase22_security_critical_remediation.sql','FUNCTION','protect_profile_privilege_escalation','public.protect_profile_privilege_escalation()','replaced'),
  ('20261020000000','20261020000000_phase23_followup_reminder_concurrency.sql','FUNCTION','process_follow_up_reminders_cron','public.process_follow_up_reminders_cron(timestamp with time zone,uuid)','replaced'),
  ('20261019000000','20261019000000_phase22_phone_exposure_remediation.sql','FUNCTION','get_telecaller_student_detail','public.get_telecaller_student_detail(uuid)','altered/replaced; view and function body comparison required'),
  ('20261021000000','20261021000000_phase23_7_production_blocker_remediation.sql','FUNCTION','grant_platform_admin','public.grant_platform_admin(uuid)','created'),
  ('20261022000000','20261022000000_phase23_8_active_profile_rls.sql','FUNCTION','is_active_authenticated_profile','public.is_active_authenticated_profile()','replaced'),
  ('20261023000000','20261023000000_billing_foundation.sql','TABLE','organization_subscriptions',NULL,'created'),
  ('20261023000000','20261023000000_billing_foundation.sql','TABLE','billing_payments',NULL,'created'),
  ('20261023000000','20261023000000_billing_foundation.sql','TABLE','billing_webhook_events',NULL,'created'),
  ('20261023120000','20261023120000_secure_caller_enrollment_bridge_persistence.sql','TABLE','caller_phone_enrollments',NULL,'created'),
  ('20261023120000','20261023120000_secure_caller_enrollment_bridge_persistence.sql','TABLE','call_bridges',NULL,'created'),
  ('20261024120000','20261024120000_phase24_3_secure_telecaller_lead_access.sql','FUNCTION','update_assigned_telecaller_lead','public.update_assigned_telecaller_lead(uuid,text,text)','created'),
  ('20261024100000','20261024100000_phase24_1_security_remediation.sql','FUNCTION','restrict_telecaller_lead_update_columns','public.restrict_telecaller_lead_update_columns()','altered; function and trigger comparison required'),
  ('20261024130000','20261024130000_phase24_7_server_telecaller_leads.sql','FUNCTION','server_get_assigned_telecaller_leads','public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)','created'),
  ('20261024130000','20261024130000_phase24_7_server_telecaller_leads.sql','FUNCTION','server_update_assigned_telecaller_lead','public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)','created'),
  ('20261027000000','20261027000000_phase32_realtime_publications.sql','PUBLICATION_TABLE','profiles',NULL,'publication membership'),
  ('20261027000000','20261027000000_phase32_realtime_publications.sql','PUBLICATION_TABLE','organization_invitations',NULL,'publication membership'),
  ('20261028000000','20261028000000_phase33_realtime_notifications.sql','PUBLICATION_TABLE','notifications',NULL,'publication membership'),
  ('20261030000000','20261030000000_owner_business_billing_details.sql','INDEX','profiles_email_unique_lower',NULL,'created'),
  ('20261030000000','20261030000000_owner_business_billing_details.sql','INDEX','organizations_owner_id_unique',NULL,'created'),
  ('20261030120000','20261030120000_owner_csv_import_persistence.sql','FUNCTION','create_owner_lead','public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)','created'),
  ('20261030120000','20261030120000_owner_csv_import_persistence.sql','FUNCTION','import_owner_leads','public.import_owner_leads(uuid,uuid,uuid,jsonb)','created'),
  ('20261031000000','20261031000000_onboarding_billing_integrity.sql','TABLE','registration_otp_attempts',NULL,'created'),
  ('20261031120000','20261031120000_sanitized_lead_refresh_signals.sql','TABLE','lead_refresh_signals',NULL,'created'),
  ('20261031130000','20261031130000_public_leads_privilege_hardening.sql','RELATION','leads',NULL,'altered; existence cannot prove effect'),
  ('20261031140000','20261031140000_security_definer_search_path_hardening.sql','FUNCTION','begin_caller_phone_enrollment','public.begin_caller_phone_enrollment(uuid,uuid,text,text)','altered metadata'),
  ('20261031150000','20261031150000_durable_email_otp_attempts.sql','FUNCTION','issue_email_otp_ticket','public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)','created'),
  ('20261031160000','20261031160000_organization_twilio_calling.sql','TABLE','organization_twilio_credentials',NULL,'created'),
  ('20261031160000','20261031160000_organization_twilio_calling.sql','TABLE','telephony_inbound_attempts',NULL,'created'),
  ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql','FUNCTION','apply_verified_razorpay_payment','public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)','created'),
  ('20261031180000','20261031180000_paid_subscription_entitlement_gate.sql','FUNCTION','organization_has_active_paid_entitlement','public.organization_has_active_paid_entitlement(uuid)','created'),
  ('20261101090000','20261101090000_followup_email_outbox.sql','TABLE','follow_up_email_outbox',NULL,'created'),
  ('20261101100000','20261101100000_unique_pending_invitations.sql','INDEX','organization_invitations_pending_org_email_uidx',NULL,'created')
), actual AS (
  SELECT e.*,
    CASE
      WHEN e.object_kind IN ('TABLE','RELATION') THEN pg_catalog.to_regclass('public.'||e.object_name) IS NOT NULL
      WHEN e.object_kind='INDEX' THEN EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=e.object_name AND c.relkind='i')
      WHEN e.object_kind='FUNCTION' THEN pg_catalog.to_regprocedure(e.exact_signature) IS NOT NULL
      WHEN e.object_kind='PUBLICATION_TABLE' THEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_publication p JOIN pg_catalog.pg_publication_rel pr ON pr.prpubid=p.oid
        JOIN pg_catalog.pg_class c ON c.oid=pr.prrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE p.pubname='supabase_realtime' AND n.nspname='public' AND c.relname=e.object_name)
      ELSE NULL
    END AS object_exists,
    CASE
      WHEN e.object_kind='TABLE' AND pg_catalog.to_regclass('public.'||e.object_name) IS NOT NULL
        THEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=e.object_name AND c.relkind IN ('r','p'))
      WHEN e.object_kind='INDEX' AND EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=e.object_name)
        THEN NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
          JOIN pg_catalog.pg_namespace ni ON ni.oid=ix.relnamespace
          JOIN pg_catalog.pg_class parent ON parent.oid=i.indrelid
          WHERE ni.nspname='public' AND ix.relname=e.object_name
            AND parent.relname = CASE e.object_name
              WHEN 'profiles_email_unique_lower' THEN 'profiles'
              WHEN 'organizations_owner_id_unique' THEN 'organizations'
              WHEN 'organization_invitations_pending_org_email_uidx' THEN 'organization_invitations'
              ELSE parent.relname END
        )
      WHEN e.object_kind='FUNCTION' AND pg_catalog.to_regprocedure(e.exact_signature) IS NULL
        THEN EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=e.object_name)
      ELSE FALSE
    END AS object_conflict
  FROM expected e
)
SELECT 'PRIMARY_ARTIFACT' AS section, version, migration_file, object_kind,
       object_name, exact_signature,
       CASE WHEN attribution LIKE 'altered%' THEN 'UNKNOWN'
            WHEN object_conflict THEN 'CONFLICTING'
            WHEN object_exists IS NULL THEN 'UNKNOWN'
            WHEN object_exists THEN 'PRESENT'
            ELSE 'MISSING' END AS classification,
       attribution AS limitation
FROM actual ORDER BY version, object_name;
