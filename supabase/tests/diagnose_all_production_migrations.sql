-- ENCRIX production schema reconciliation. SQL Editor compatible, read-only.
-- Execute only after independently selecting the intended production project.
-- This script reads catalogs and emits aggregate conflict counts only. It does
-- not select customer/lead/payment/subscription/personal row values or invoke
-- application RPCs. All dynamic SQL below is a fixed aggregate SELECT guarded
-- by catalog existence checks; no DDL/DML/transaction control is present.

-- SECTION 1: Database identity. Compare with the approved project out of band.
SELECT 'DATABASE_IDENTITY' AS section,
       current_database() AS database_name,
       current_user AS current_role,
       session_user AS session_role,
       version() AS server_version,
       inet_server_addr()::text AS server_address,
       inet_server_port() AS server_port;

-- SECTION 2: Required Supabase roles, schemas, extensions and publication.
WITH expected(kind, object_name, schema_name) AS (
  VALUES
    ('ROLE','anon',NULL::text), ('ROLE','authenticated',NULL),
    ('ROLE','service_role',NULL), ('SCHEMA','auth',NULL),
    ('SCHEMA','extensions',NULL), ('EXTENSION','uuid-ossp','extensions'),
    ('PUBLICATION','supabase_realtime',NULL)
)
SELECT 'PREREQUISITE' AS section, e.kind, e.object_name,
       CASE e.kind
         WHEN 'ROLE' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=e.object_name) THEN 'PRESENT' ELSE 'MISSING' END
         WHEN 'SCHEMA' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname=e.object_name) THEN 'PRESENT' ELSE 'MISSING' END
         WHEN 'EXTENSION' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_extension x JOIN pg_catalog.pg_namespace n ON n.oid=x.extnamespace WHERE x.extname=e.object_name AND n.nspname=e.schema_name) THEN 'PRESENT' ELSE 'MISSING' END
         WHEN 'PUBLICATION' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_publication p WHERE p.pubname=e.object_name) THEN 'PRESENT' ELSE 'MISSING' END
       END AS classification
FROM expected e
ORDER BY e.kind, e.object_name;

WITH expected(schema_name, relation_name) AS (
  VALUES ('auth','users'),('public','organizations'),('public','profiles'),
         ('public','leads'),('public','lead_assignments'),('public','calls'),
         ('public','follow_ups'),('public','notifications'),('public','activity_logs'),
         ('public','security_events'),('public','organization_invitations'),
         ('public','pending_registrations'),('public','email_otps')
)
SELECT 'DEPENDENCY_RELATION' AS section, schema_name, relation_name,
       CASE WHEN pg_catalog.to_regclass(pg_catalog.format('%I.%I',schema_name,relation_name)) IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS classification
FROM expected ORDER BY schema_name,relation_name;

-- SECTION 3: Migration-history evidence. A missing/incompatible table yields
-- UNKNOWN safely. Only version/count values are returned.
WITH history_shape AS (
  SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS rel,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_attribute a
           WHERE a.attrelid=pg_catalog.to_regclass('supabase_migrations.schema_migrations')
             AND a.attname='version' AND a.attnum>0 AND NOT a.attisdropped
         ) AS has_version
), expected(version) AS (
  VALUES ('20261001000000'),('20261001000001'),
    ('20261006000000'),('20261007000000'),('20261008000000'),
    ('20261012000000'),('20261013000000'),('20261014000000'),
    ('20261015000000'),('20261018000000'),('20261019000000'),
    ('20261020000000'),('20261021000000'),('20261022000000'),
    ('20261023000000'),('20261023120000'),('20261024100000'),
    ('20261024120000'),('20261024130000'),('20261027000000'),
    ('20261028000000'),('20261030000000'),('20261030120000'),
    ('20261031000000'),('20261031120000'),('20261031130000'),
    ('20261031140000'),('20261031150000'),('20261031160000'),
    ('20261031170000'),('20261031180000'),('20261101090000'),
    ('20261101100000')
)
SELECT 'MIGRATION_HISTORY' AS section, e.version,
       CASE WHEN h.rel IS NULL OR NOT h.has_version THEN 'UNKNOWN'
            WHEN COALESCE(((pg_catalog.xpath('/table/row/migration_version_count/text()',
                 pg_catalog.query_to_xml(
                   'SELECT count(*) AS migration_version_count FROM supabase_migrations.schema_migrations WHERE version = '
                   || pg_catalog.quote_literal(e.version), true, false, '')))[1])::text,'0')::integer = 0 THEN 'MISSING'
            WHEN COALESCE(((pg_catalog.xpath('/table/row/migration_version_count/text()',
                 pg_catalog.query_to_xml(
                   'SELECT count(*) AS migration_version_count FROM supabase_migrations.schema_migrations WHERE version = '
                   || pg_catalog.quote_literal(e.version), true, false, '')))[1])::text,'0')::integer = 1 THEN 'PRESENT'
            ELSE 'CONFLICTING' END AS classification,
       CASE WHEN h.rel IS NULL OR NOT h.has_version THEN NULL::xml
            ELSE pg_catalog.query_to_xml(
              'SELECT count(*) AS migration_version_count FROM supabase_migrations.schema_migrations WHERE version = '
              || pg_catalog.quote_literal(e.version), true, false, '') END AS version_count_xml
FROM expected e CROSS JOIN history_shape h
ORDER BY e.version;

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

-- SECTION 5: Exact public relation and column inventory. This returns schema
-- metadata only; compare definitions with the source migrations.
SELECT 'RELATION_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, c.relkind, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
       c.relreplident AS replica_identity, c.relacl AS stored_acl,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
ORDER BY c.relname;

SELECT 'COLUMN_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, a.attnum AS ordinal_position, a.attname AS column_name,
       pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
       a.attidentity AS identity_kind, a.attgenerated AS generated_kind, a.attacl AS column_acl,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname,a.attnum;

-- SECTION 6: All public indexes and constraints, including exact definitions.
SELECT 'INDEX_CATALOG' AS section, ni.nspname AS index_schema, ci.relname AS index_name,
       nt.nspname AS parent_schema, ct.relname AS parent_table,
       i.indisunique AS is_unique, i.indisvalid AS is_valid, i.indisready AS is_ready,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS definition,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ci ON ci.oid=i.indexrelid
JOIN pg_catalog.pg_namespace ni ON ni.oid=ci.relnamespace
JOIN pg_catalog.pg_class ct ON ct.oid=i.indrelid
JOIN pg_catalog.pg_namespace nt ON nt.oid=ct.relnamespace
WHERE nt.nspname='public' ORDER BY ct.relname,ci.relname;

SELECT 'CONSTRAINT_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, con.conname AS constraint_name,
       con.contype AS constraint_type, con.convalidated AS validated,
       con.condeferrable AS deferrable, con.condeferred AS initially_deferred,
       pg_catalog.pg_get_constraintdef(con.oid,true) AS definition,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' ORDER BY c.relname,con.conname;

-- SECTION 7: Routines, bodies, ownership, security metadata and effective
-- execute checks. Definitions are implementation metadata, not customer data.
SELECT 'FUNCTION_CATALOG' AS section, p.oid::regprocedure::text AS signature,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner, l.lanname AS language,
       p.prosecdef AS security_definer, p.provolatile AS volatility,
       p.proisstrict AS strict, p.proparallel AS parallel,
       p.proconfig AS function_settings, p.proacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_role_execute,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE') END AS postgres_execute,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN pg_catalog.has_function_privilege('supabase_admin',p.oid,'EXECUTE') END AS supabase_admin_execute,
       pg_catalog.pg_get_functiondef(p.oid) AS definition,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND p.prokind <> 'a'
ORDER BY p.proname,p.oid::regprocedure::text;

-- SECTION 8: Triggers and policies. Expressions are catalog definitions;
-- presence alone does not establish semantic equivalence.
SELECT 'TRIGGER_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, t.tgname AS trigger_name,
       pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
       p.oid::regprocedure::text AS trigger_function,
       t.tgenabled AS enabled_state, pg_catalog.pg_get_triggerdef(t.oid,true) AS definition,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND n.nspname='public' ORDER BY c.relname,t.tgname;

SELECT 'POLICY_CATALOG' AS section, schemaname, tablename, policyname,
       permissive, roles, cmd, qual, with_check,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_policies WHERE schemaname='public'
ORDER BY tablename,policyname;

-- SECTION 9: Stored/effective ACLs for public relations and columns.
SELECT 'TABLE_ACL' AS section, n.nspname AS schema_name,c.relname AS relation_name,
       c.relacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN ARRAY[
         pg_catalog.has_table_privilege('anon',c.oid,'SELECT'),pg_catalog.has_table_privilege('anon',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('anon',c.oid,'UPDATE'),pg_catalog.has_table_privilege('anon',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('anon',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('anon',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('anon',c.oid,'TRIGGER')] END AS anon_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN ARRAY[
         pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'),pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE'),pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('authenticated',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('authenticated',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('authenticated',c.oid,'TRIGGER')] END AS authenticated_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN ARRAY[
         pg_catalog.has_table_privilege('service_role',c.oid,'SELECT'),pg_catalog.has_table_privilege('service_role',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('service_role',c.oid,'UPDATE'),pg_catalog.has_table_privilege('service_role',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('service_role',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('service_role',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('service_role',c.oid,'TRIGGER')] END AS service_role_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN ARRAY[
         pg_catalog.has_table_privilege('postgres',c.oid,'SELECT'),pg_catalog.has_table_privilege('postgres',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('postgres',c.oid,'UPDATE'),pg_catalog.has_table_privilege('postgres',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('postgres',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('postgres',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('postgres',c.oid,'TRIGGER')] END AS postgres_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN ARRAY[
         pg_catalog.has_table_privilege('supabase_admin',c.oid,'SELECT'),pg_catalog.has_table_privilege('supabase_admin',c.oid,'INSERT'),
         pg_catalog.has_table_privilege('supabase_admin',c.oid,'UPDATE'),pg_catalog.has_table_privilege('supabase_admin',c.oid,'DELETE'),
         pg_catalog.has_table_privilege('supabase_admin',c.oid,'TRUNCATE'),pg_catalog.has_table_privilege('supabase_admin',c.oid,'REFERENCES'),
         pg_catalog.has_table_privilege('supabase_admin',c.oid,'TRIGGER')] END AS supabase_admin_effective_privileges,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN pg_catalog.has_table_privilege('anon',c.oid,'MAINTAIN') END AS anon_maintain,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN pg_catalog.has_table_privilege('authenticated',c.oid,'MAINTAIN') END AS authenticated_maintain,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN pg_catalog.has_table_privilege('service_role',c.oid,'MAINTAIN') END AS service_role_maintain,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN pg_catalog.has_table_privilege('postgres',c.oid,'MAINTAIN') END AS postgres_maintain,
       CASE WHEN pg_catalog.current_setting('server_version_num')::integer>=170000 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN pg_catalog.has_table_privilege('supabase_admin',c.oid,'MAINTAIN') END AS supabase_admin_maintain,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') ORDER BY c.relname;

SELECT 'COLUMN_ACL' AS section, c.relname AS relation_name,a.attname AS column_name,a.attacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN ARRAY[
         pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'REFERENCES')] END AS anon_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN ARRAY[
         pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'REFERENCES')] END AS authenticated_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN ARRAY[
         pg_catalog.has_column_privilege('service_role',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('service_role',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('service_role',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('service_role',c.oid,a.attnum,'REFERENCES')] END AS service_role_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN ARRAY[
         pg_catalog.has_column_privilege('postgres',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('postgres',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('postgres',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('postgres',c.oid,a.attnum,'REFERENCES')] END AS postgres_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN ARRAY[
         pg_catalog.has_column_privilege('supabase_admin',c.oid,a.attnum,'SELECT'),pg_catalog.has_column_privilege('supabase_admin',c.oid,a.attnum,'INSERT'),
         pg_catalog.has_column_privilege('supabase_admin',c.oid,a.attnum,'UPDATE'),pg_catalog.has_column_privilege('supabase_admin',c.oid,a.attnum,'REFERENCES')] END AS supabase_admin_effective_privileges,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
  AND a.attacl IS NOT NULL ORDER BY c.relname,a.attnum;

SELECT 'DEFAULT_ACL_CATALOG' AS section,
       pg_catalog.pg_get_userbyid(d.defaclrole) AS creator_role,
       CASE WHEN d.defaclnamespace=0 THEN '<GLOBAL>' ELSE n.nspname END AS schema_scope,
       d.defaclobjtype AS object_type, d.defaclacl AS stored_default_acl,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
WHERE d.defaclrole IN (SELECT oid FROM pg_catalog.pg_roles
                       WHERE rolname IN ('postgres','supabase_admin'))
   OR d.defaclnamespace=0
ORDER BY creator_role,schema_scope,object_type;

SELECT 'SCHEMA_ACL' AS section,n.nspname AS schema_name,n.nspacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN ARRAY[
         pg_catalog.has_schema_privilege('anon',n.oid,'USAGE'),pg_catalog.has_schema_privilege('anon',n.oid,'CREATE')] END AS anon_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN ARRAY[
         pg_catalog.has_schema_privilege('authenticated',n.oid,'USAGE'),pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE')] END AS authenticated_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN ARRAY[
         pg_catalog.has_schema_privilege('service_role',n.oid,'USAGE'),pg_catalog.has_schema_privilege('service_role',n.oid,'CREATE')] END AS service_role_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN ARRAY[
         pg_catalog.has_schema_privilege('postgres',n.oid,'USAGE'),pg_catalog.has_schema_privilege('postgres',n.oid,'CREATE')] END AS postgres_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN ARRAY[
         pg_catalog.has_schema_privilege('supabase_admin',n.oid,'USAGE'),pg_catalog.has_schema_privilege('supabase_admin',n.oid,'CREATE')] END AS supabase_admin_effective_privileges,
       'PRESENT'::text AS catalog_classification,'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_namespace n
WHERE n.nspname IN ('public','auth','extensions') ORDER BY n.nspname;

SELECT 'SEQUENCE_ACL' AS section,n.nspname AS schema_name,c.relname AS sequence_name,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,c.relacl AS stored_acl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN ARRAY[
         pg_catalog.has_sequence_privilege('anon',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('anon',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('anon',c.oid,'UPDATE')] END AS anon_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN ARRAY[
         pg_catalog.has_sequence_privilege('authenticated',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('authenticated',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('authenticated',c.oid,'UPDATE')] END AS authenticated_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN ARRAY[
         pg_catalog.has_sequence_privilege('service_role',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('service_role',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('service_role',c.oid,'UPDATE')] END AS service_role_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='postgres') THEN ARRAY[
         pg_catalog.has_sequence_privilege('postgres',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('postgres',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('postgres',c.oid,'UPDATE')] END AS postgres_effective_privileges,
       CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='supabase_admin') THEN ARRAY[
         pg_catalog.has_sequence_privilege('supabase_admin',c.oid,'USAGE'),pg_catalog.has_sequence_privilege('supabase_admin',c.oid,'SELECT'),pg_catalog.has_sequence_privilege('supabase_admin',c.oid,'UPDATE')] END AS supabase_admin_effective_privileges,
       'PRESENT'::text AS catalog_classification,'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='S' AND n.nspname='public' ORDER BY c.relname;

-- SECTION 10: Realtime membership and column filters.
SELECT 'PUBLICATION_CATALOG' AS section,p.pubname,c.relname AS relation_name,
       pr.prattrs AS published_attribute_numbers,
       CASE WHEN pr.prattrs IS NULL THEN 'ALL COLUMNS' ELSE
         (SELECT string_agg(a.attname,', ' ORDER BY u.attnum)
            FROM unnest(pr.prattrs) WITH ORDINALITY AS u(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=pr.prrelid AND a.attnum=u.attnum)
       END AS published_columns,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_publication p
LEFT JOIN pg_catalog.pg_publication_rel pr ON pr.prpubid=p.oid
LEFT JOIN pg_catalog.pg_class c ON c.oid=pr.prrelid
WHERE p.pubname='supabase_realtime' ORDER BY c.relname;

-- SECTION 11: Aggregate-only data compatibility checks. Each result is
-- UNKNOWN if required relation/columns are missing; values/records never emit.
WITH checks(check_name, required_relation, required_columns, aggregate_sql) AS (
 VALUES
 ('profile_email_casefold_duplicates','public.profiles',ARRAY['email']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT lower(email) FROM public.profiles WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*)>1) q'),
 ('organization_owner_duplicates','public.organizations',ARRAY['owner_id']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT owner_id FROM public.organizations WHERE owner_id IS NOT NULL GROUP BY owner_id HAVING count(*)>1) q'),
 ('pending_registration_email_duplicates','public.pending_registrations',ARRAY['email']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT email FROM public.pending_registrations WHERE email IS NOT NULL GROUP BY email HAVING count(*)>1) q'),
 ('email_otp_duplicate_ticket_ids','public.email_otps',ARRAY['ticket_id']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT ticket_id FROM public.email_otps WHERE ticket_id IS NOT NULL GROUP BY ticket_id HAVING count(*)>1) q'),
 ('pending_invitation_duplicates','public.organization_invitations',ARRAY['organization_id','status','email']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT organization_id,lower(btrim(email)) FROM public.organization_invitations WHERE status=''PENDING'' AND email IS NOT NULL GROUP BY organization_id,lower(btrim(email)) HAVING count(*)>1) q'),
 ('normalized_lead_phone_duplicates','public.leads',ARRAY['organization_id','phone']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT organization_id,regexp_replace(phone,''\D'','''',''g'') FROM public.leads WHERE phone IS NOT NULL AND regexp_replace(phone,''\D'','''',''g'')<>'''' GROUP BY organization_id,regexp_replace(phone,''\D'','''',''g'') HAVING count(*)>1) q'),
 ('csv_import_marker_duplicates','public.leads',ARRAY['organization_id','metadata']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT organization_id,metadata->>''csv_import_id'',metadata->>''csv_import_row_index'' FROM public.leads WHERE metadata ? ''csv_import_id'' AND metadata->>''csv_import_row_index'' IS NOT NULL GROUP BY organization_id,metadata->>''csv_import_id'',metadata->>''csv_import_row_index'' HAVING count(*)>1) q'),
 ('billing_nonpositive_subscription_amounts','public.organization_subscriptions',ARRAY['amount_paise']::text[],
  'SELECT count(*) AS conflict_count FROM public.organization_subscriptions WHERE amount_paise<=0'),
 ('billing_nonpositive_razorpay_total_counts','public.organization_subscriptions',ARRAY['razorpay_total_count']::text[],
  'SELECT count(*) AS conflict_count FROM public.organization_subscriptions WHERE razorpay_total_count IS NOT NULL AND razorpay_total_count<=0'),
 ('billing_invalid_refund_amounts','public.billing_payments',ARRAY['amount_paise','amount_refunded_paise']::text[],
  'SELECT count(*) AS conflict_count FROM public.billing_payments WHERE amount_refunded_paise<0 OR amount_refunded_paise>amount_paise'),
 ('billing_missing_subscription_links','public.billing_payments',ARRAY['subscription_id']::text[],
  'SELECT count(*) AS conflict_count FROM public.billing_payments WHERE subscription_id IS NULL'),
 ('billing_payment_state_timestamp_conflicts','public.billing_payments',ARRAY['status','paid_at','signature_verified_at','failed_at']::text[],
  'SELECT count(*) AS conflict_count FROM public.billing_payments WHERE (status=''captured'' AND (paid_at IS NULL OR signature_verified_at IS NULL)) OR (status=''failed'' AND failed_at IS NULL)'),
 ('active_twilio_phone_duplicates','public.organization_twilio_credentials',ARRAY['twilio_phone_number','status']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT twilio_phone_number FROM public.organization_twilio_credentials WHERE status=''ACTIVE'' GROUP BY twilio_phone_number HAVING count(*)>1) q'),
 ('twilio_duplicate_provider_call_ids','public.calls',ARRAY['provider_call_id']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT provider_call_id FROM public.calls WHERE provider_call_id IS NOT NULL GROUP BY provider_call_id HAVING count(*)>1) q')
), evaluated AS (
 SELECT c.*,
   pg_catalog.to_regclass(c.required_relation) AS rel,
   NOT EXISTS (
     SELECT 1 FROM unnest(c.required_columns) AS req(col)
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid=pg_catalog.to_regclass(c.required_relation)
                         AND a.attname=req.col AND a.attnum>0 AND NOT a.attisdropped)
   ) AS columns_ok
 FROM checks c
), results AS (
 SELECT e.*,
   CASE WHEN rel IS NULL OR NOT columns_ok THEN NULL::xml
        ELSE pg_catalog.query_to_xml(aggregate_sql,true,false,'') END AS aggregate_xml
 FROM evaluated e
)
SELECT 'DATA_PREFLIGHT' AS section, check_name,
       CASE WHEN rel IS NULL OR NOT columns_ok THEN 'UNKNOWN'
            WHEN COALESCE(((pg_catalog.xpath('/table/row/conflict_count/text()',aggregate_xml))[1])::text,'0')::bigint > 0 THEN 'CONFLICTING'
            ELSE 'PRESENT' END AS classification,
       CASE WHEN aggregate_xml IS NULL THEN NULL::bigint
            ELSE COALESCE(((pg_catalog.xpath('/table/row/conflict_count/text()',aggregate_xml))[1])::text,'0')::bigint END AS aggregate_conflict_count
FROM results ORDER BY check_name;

-- SECTION 12: Migration-level status. A migration is PRESENT only after every
-- expected effect has been matched manually to source; this catalog-only
-- diagnostic deliberately leaves whole-migration conclusions UNKNOWN.
WITH migrations(version, file_name) AS (
 VALUES
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
 ('20261101100000','20261101100000_unique_pending_invitations.sql')
)
SELECT 'MIGRATION_CLASSIFICATION' AS section,version,file_name,
       'UNKNOWN'::text AS classification,
       'Catalog output for every source effect must be compared; migration history alone is not proof.'::text AS evidence_required
FROM migrations ORDER BY version;
