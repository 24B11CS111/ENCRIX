-- ENCRIX Production migration prerequisite and conflict preflight.
-- READ ONLY: catalog inspection plus aggregate-only SELECTs. No customer rows
-- or personal values are returned, and no application RPC is invoked.
-- Before use, independently confirm the SQL Editor project reference is
-- wrzoqxesffbfirjgotbr. This query cannot establish the Supabase project ID.
-- Run the complete file or one complete labeled statement; avoid partial text
-- selections. Every result check_name starts with S01 through S10 for triage.

-- SECTION 1: connection context (project identity must be confirmed separately).
SELECT 'S01_DATABASE_CONTEXT'::text AS check_name,
       current_database()::text AS database_name,
       current_user::text AS current_role,
       session_user::text AS session_role,
       current_setting('server_version') AS server_version,
       'wrzoqxesffbfirjgotbr (verify independently in Supabase dashboard)'::text AS expected_project;

-- SECTION 2: migration history. query_to_xml evaluates only a fixed COUNT SELECT
-- guarded by a catalog check; only version and count are returned.
WITH expected_migrations(version, migration_file) AS (
  VALUES
    ('20261001000000','20261001000000_init_leadvault.sql'),
    ('20261007000000','20261007000000_otp_authentication_and_onboarding.sql'),
    ('20261008000000','20261008000000_email_otp_authentication.sql'),
    ('20261023000000','20261023000000_billing_foundation.sql'),
    ('20261030000000','20261030000000_owner_business_billing_details.sql'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql'),
    ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql'),
    ('20261031180000','20261031180000_paid_subscription_entitlement_gate.sql'),
    ('20261104120000','20261104120000_founding_pilot_entitlements.sql')
), history_shape AS (
  SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS rel,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = pg_catalog.to_regclass('supabase_migrations.schema_migrations')
              AND a.attname = 'version'
              AND a.atttypid IN ('pg_catalog.text'::pg_catalog.regtype,'pg_catalog.varchar'::pg_catalog.regtype,'pg_catalog.bpchar'::pg_catalog.regtype)
              AND a.attnum > 0 AND NOT a.attisdropped
         ) AS has_version
)
SELECT 'S02_MIGRATION_HISTORY:' || e.version AS check_name,
       CASE WHEN h.rel IS NULL OR NOT h.has_version THEN 'REVIEW_REQUIRED'
            WHEN c.recorded_count = 0 THEN 'MISSING'
            WHEN c.recorded_count = 1 THEN 'PASS'
            ELSE 'FAIL' END AS result,
       e.migration_file,
       CASE WHEN h.rel IS NULL THEN 'history table absent'
            WHEN NOT h.has_version THEN 'version column absent'
            ELSE 'recorded_count=' || c.recorded_count::text END AS actual_value,
       'exactly one version row; history alone does not prove schema effects'::text AS expected_value
  FROM expected_migrations e
 CROSS JOIN history_shape h
 CROSS JOIN LATERAL (
   SELECT CASE WHEN h.rel IS NOT NULL AND h.has_version THEN
     COALESCE(((pg_catalog.xpath(
       '/table/row/recorded_count/text()',
       pg_catalog.query_to_xml(
         'SELECT count(*)::bigint AS recorded_count FROM supabase_migrations.schema_migrations WHERE version = '
         || pg_catalog.quote_literal(e.version), TRUE, FALSE, '')
     ))[1])::text, '0')::bigint ELSE NULL END AS recorded_count
 ) c
 ORDER BY e.version;

-- SECTION 3: required roles, schemas and extension.
WITH expected(kind, object_name, schema_name) AS (
  VALUES ('ROLE','anon',NULL::text), ('ROLE','authenticated',NULL::text),
         ('ROLE','service_role',NULL::text), ('SCHEMA','public',NULL::text),
         ('SCHEMA','extensions',NULL::text), ('SCHEMA','auth',NULL::text),
         ('EXTENSION','uuid-ossp','extensions')
)
SELECT 'S03_PREREQUISITE:' || e.kind || ':' || e.object_name AS check_name,
       CASE e.kind
         WHEN 'ROLE' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=e.object_name) THEN 'PASS' ELSE 'MISSING' END
         WHEN 'SCHEMA' THEN CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname=e.object_name) THEN 'PASS' ELSE 'MISSING' END
         WHEN 'EXTENSION' THEN CASE WHEN EXISTS (
           SELECT 1 FROM pg_catalog.pg_extension x JOIN pg_catalog.pg_namespace n ON n.oid=x.extnamespace
            WHERE x.extname=e.object_name AND n.nspname=e.schema_name
         ) THEN 'PASS' ELSE 'MISSING' END
       END AS result,
       e.kind || ' ' || e.object_name || COALESCE(' in ' || e.schema_name,'') AS expected_value
  FROM expected e ORDER BY e.kind, e.object_name;

SELECT 'S03_UUID_GENERATOR:extensions.uuid_generate_v4()'::text AS check_name,
       CASE WHEN pg_catalog.to_regprocedure('extensions.uuid_generate_v4()') IS NULL THEN 'MISSING' ELSE 'PASS' END AS result,
       COALESCE(pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')),'function absent') AS actual_value,
       'zero-argument UUID generator in extensions schema'::text AS expected_value;

-- SECTION 4: required relations and RLS state. Definitions are shown as catalog
-- metadata; table contents are never selected.
WITH expected_tables(table_name, required_by) AS (
  VALUES ('organizations','base/onboarding/billing/pilot'),
         ('profiles','base/onboarding/billing/pilot'),
         ('organization_invitations','email onboarding'),
         ('pending_registrations','owner onboarding'),
         ('phone_otps','OTP onboarding'),
         ('email_otps','email OTP onboarding'),
         ('registration_otp_attempts','billing-integrity prerequisite'),
         ('organization_subscriptions','billing entitlement'),
         ('billing_payments','billing entitlement'),
         ('billing_webhook_events','billing foundation'),
         ('organization_pilot_entitlements','founding pilot'),
         ('organization_pilot_entitlement_events','founding pilot audit')
)
SELECT 'S04_TABLE:' || e.table_name AS check_name,
       CASE WHEN c.oid IS NULL THEN 'MISSING'
            WHEN c.relkind <> 'r' THEN 'FAIL' ELSE 'PASS' END AS result,
       COALESCE('relkind=' || c.relkind::text || '; owner=' || pg_catalog.pg_get_userbyid(c.relowner)::text,'relation absent') AS actual_value,
       'ordinary public table; ' || e.required_by AS expected_value,
       CASE WHEN c.oid IS NOT NULL THEN c.relrowsecurity::text END AS rls_enabled
  FROM expected_tables e
  LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.' || e.table_name)
 ORDER BY e.table_name;

-- SECTION 5: exact expected columns. Default expressions are compared to their
-- PostgreSQL catalog rendering and are also returned for manual review.
WITH expected_columns(table_name,column_name,type_name,is_not_null,default_expr,source_migration) AS (
  VALUES
  ('organizations','id','uuid',TRUE,'extensions.uuid_generate_v4()','010000'),
  ('organizations','name','character varying(255)',TRUE,'<none>','010000'),
  ('organizations','slug','character varying(100)',TRUE,'<none>','010000'),
  ('organizations','owner_id','uuid',TRUE,'<none>','010000'),
  ('organizations','industry','character varying(100)',FALSE,'''General''::character varying','010000'),
  ('organizations','company_size','character varying(50)',FALSE,'''1-10''::character varying','010000'),
  ('organizations','logo_url','text',FALSE,'<none>','010000'),
  ('organizations','status','character varying(50)',FALSE,'''ACTIVE''::character varying','010000'),
  ('organizations','created_at','timestamp with time zone',FALSE,'now()','010000'),
  ('organizations','updated_at','timestamp with time zone',FALSE,'now()','010000'),
  ('organizations','business_email','character varying(255)',FALSE,'<none>','300000'),
  ('organizations','business_phone','character varying(50)',FALSE,'<none>','300000'),
  ('organizations','business_location','character varying(500)',FALSE,'<none>','300000'),
  ('organizations','website_url','text',FALSE,'<none>','300000'),
  ('profiles','id','uuid',TRUE,'extensions.uuid_generate_v4()','010000'),
  ('profiles','user_id','uuid',TRUE,'<none>','010000'),
  ('profiles','organization_id','uuid',FALSE,'<none>','010000'),
  ('profiles','full_name','character varying(255)',TRUE,'<none>','010000'),
  ('profiles','phone','character varying(50)',FALSE,'<none>','010000'),
  ('profiles','role','character varying(50)',TRUE,'<none>','010000'),
  ('profiles','avatar_url','text',FALSE,'<none>','010000'),
  ('profiles','status','character varying(50)',FALSE,'''ACTIVE''::character varying','010000'),
  ('profiles','created_at','timestamp with time zone',FALSE,'now()','010000'),
  ('profiles','updated_at','timestamp with time zone',FALSE,'now()','010000'),
  ('profiles','phone_verified','boolean',TRUE,'false','070000'),
  ('profiles','email','character varying(255)',FALSE,'<none>','080000'),
  ('profiles','email_verified','boolean',TRUE,'false','080000'),
  ('organization_invitations','id','uuid',TRUE,'extensions.uuid_generate_v4()','070000'),
  ('organization_invitations','organization_id','uuid',TRUE,'<none>','070000'),
  ('organization_invitations','phone_number','character varying(50)',FALSE,'<none>','080000'),
  ('organization_invitations','full_name','character varying(255)',TRUE,'<none>','070000'),
  ('organization_invitations','email','character varying(255)',FALSE,'<none>','070000'),
  ('organization_invitations','invited_by','uuid',TRUE,'<none>','070000'),
  ('organization_invitations','role','character varying(50)',TRUE,'''TELECALLER''::character varying','070000'),
  ('organization_invitations','status','character varying(50)',TRUE,'''PENDING''::character varying','070000'),
  ('organization_invitations','token','character varying(100)',TRUE,'<none>','070000'),
  ('organization_invitations','expires_at','timestamp with time zone',TRUE,'<none>','070000'),
  ('organization_invitations','created_at','timestamp with time zone',TRUE,'now()','070000'),
  ('pending_registrations','id','uuid',TRUE,'extensions.uuid_generate_v4()','070000'),
  ('pending_registrations','phone_number','character varying(50)',FALSE,'<none>','080000'),
  ('pending_registrations','company_name','character varying(255)',TRUE,'<none>','070000'),
  ('pending_registrations','owner_name','character varying(255)',TRUE,'<none>','070000'),
  ('pending_registrations','email','character varying(255)',FALSE,'<none>','070000'),
  ('pending_registrations','industry','character varying(100)',FALSE,'''General''::character varying','070000'),
  ('pending_registrations','company_size','character varying(50)',FALSE,'''1-10''::character varying','070000'),
  ('pending_registrations','otp_hash','character varying(255)',TRUE,'<none>','070000'),
  ('pending_registrations','attempts','integer',TRUE,'0','070000'),
  ('pending_registrations','resend_after','timestamp with time zone',TRUE,'<none>','070000'),
  ('pending_registrations','expires_at','timestamp with time zone',TRUE,'<none>','070000'),
  ('pending_registrations','created_at','timestamp with time zone',TRUE,'now()','070000'),
  ('pending_registrations','business_email','character varying(255)',FALSE,'<none>','300000'),
  ('pending_registrations','business_phone','character varying(50)',FALSE,'<none>','300000'),
  ('pending_registrations','business_location','character varying(500)',FALSE,'<none>','300000'),
  ('pending_registrations','website_url','text',FALSE,'<none>','300000'),
  ('pending_registrations','otp_ticket_id','uuid',FALSE,'<none>','310000'),
  ('phone_otps','id','uuid',TRUE,'extensions.uuid_generate_v4()','070000'),
  ('phone_otps','phone_number','character varying(50)',TRUE,'<none>','070000'),
  ('phone_otps','purpose','character varying(50)',TRUE,'<none>','070000'),
  ('phone_otps','otp_hash','character varying(255)',TRUE,'<none>','070000'),
  ('phone_otps','attempts','integer',TRUE,'0','070000'),
  ('phone_otps','resend_after','timestamp with time zone',TRUE,'<none>','070000'),
  ('phone_otps','expires_at','timestamp with time zone',TRUE,'<none>','070000'),
  ('phone_otps','used','boolean',TRUE,'false','070000'),
  ('phone_otps','created_at','timestamp with time zone',TRUE,'now()','070000'),
  ('email_otps','id','uuid',TRUE,'extensions.uuid_generate_v4()','080000'),
  ('email_otps','email','character varying(255)',TRUE,'<none>','080000'),
  ('email_otps','purpose','character varying(50)',TRUE,'<none>','080000'),
  ('email_otps','otp_hash','character varying(255)',TRUE,'<none>','080000'),
  ('email_otps','attempts','integer',TRUE,'0','080000'),
  ('email_otps','resend_after','timestamp with time zone',TRUE,'<none>','080000'),
  ('email_otps','expires_at','timestamp with time zone',TRUE,'<none>','080000'),
  ('email_otps','used','boolean',TRUE,'false','080000'),
  ('email_otps','created_at','timestamp with time zone',TRUE,'now()','080000'),
  ('registration_otp_attempts','ticket_id','uuid',TRUE,'<none>','310000'),
  ('registration_otp_attempts','email','text',TRUE,'<none>','310000'),
  ('registration_otp_attempts','otp_hash','text',FALSE,'<none>','310000'),
  ('registration_otp_attempts','attempts','smallint',TRUE,'0','310000'),
  ('registration_otp_attempts','verified_at','timestamp with time zone',FALSE,'<none>','310000'),
  ('registration_otp_attempts','consumed_at','timestamp with time zone',FALSE,'<none>','310000'),
  ('registration_otp_attempts','expires_at','timestamp with time zone',TRUE,'<none>','310000'),
  ('organization_subscriptions','id','uuid',TRUE,'extensions.uuid_generate_v4()','230000'),
  ('organization_subscriptions','organization_id','uuid',TRUE,'<none>','230000'),
  ('organization_subscriptions','plan_code','text',TRUE,'<none>','230000'),
  ('organization_subscriptions','status','text',TRUE,'<none>','230000'),
  ('organization_subscriptions','entitlement_source','text',TRUE,'<none>','230000'),
  ('organization_subscriptions','is_current','boolean',TRUE,'true','230000'),
  ('organization_subscriptions','checkout_idempotency_key','uuid',TRUE,'<none>','230000'),
  ('organization_subscriptions','checkout_creation_status','text',TRUE,'''creating''::text','230000'),
  ('organization_subscriptions','amount_paise','bigint',FALSE,'<none>','230000'),
  ('organization_subscriptions','razorpay_customer_id','text',FALSE,'<none>','230000'),
  ('organization_subscriptions','razorpay_plan_id','text',FALSE,'<none>','230000'),
  ('organization_subscriptions','razorpay_subscription_id','text',FALSE,'<none>','230000'),
  ('organization_subscriptions','razorpay_short_url','text',FALSE,'<none>','230000'),
  ('organization_subscriptions','current_period_start','timestamp with time zone',FALSE,'<none>','230000'),
  ('organization_subscriptions','current_period_end','timestamp with time zone',FALSE,'<none>','230000'),
  ('organization_subscriptions','cancel_at_period_end','boolean',TRUE,'false','230000'),
  ('organization_subscriptions','cancelled_at','timestamp with time zone',FALSE,'<none>','230000'),
  ('organization_subscriptions','ended_at','timestamp with time zone',FALSE,'<none>','230000'),
  ('organization_subscriptions','last_payment_at','timestamp with time zone',FALSE,'<none>','230000'),
  ('organization_subscriptions','created_at','timestamp with time zone',TRUE,'now()','230000'),
  ('organization_subscriptions','updated_at','timestamp with time zone',TRUE,'now()','230000'),
  ('organization_subscriptions','razorpay_total_count','integer',FALSE,'<none>','311700'),
  ('billing_payments','id','uuid',TRUE,'extensions.uuid_generate_v4()','230000'),
  ('billing_payments','organization_id','uuid',TRUE,'<none>','230000'),
  ('billing_payments','subscription_id','uuid',FALSE,'<none>','230000'),
  ('billing_payments','provider','text',TRUE,'''razorpay''::text','230000'),
  ('billing_payments','idempotency_key','text',TRUE,'<none>','230000'),
  ('billing_payments','razorpay_order_id','text',FALSE,'<none>','230000'),
  ('billing_payments','razorpay_payment_id','text',FALSE,'<none>','230000'),
  ('billing_payments','razorpay_invoice_id','text',FALSE,'<none>','230000'),
  ('billing_payments','amount_paise','bigint',TRUE,'<none>','230000'),
  ('billing_payments','currency','text',TRUE,'''INR''::text','230000'),
  ('billing_payments','status','text',TRUE,'<none>','230000'),
  ('billing_payments','signature_verified_at','timestamp with time zone',FALSE,'<none>','230000'),
  ('billing_payments','paid_at','timestamp with time zone',FALSE,'<none>','230000'),
  ('billing_payments','failed_at','timestamp with time zone',FALSE,'<none>','230000'),
  ('billing_payments','created_at','timestamp with time zone',TRUE,'now()','230000'),
  ('billing_payments','updated_at','timestamp with time zone',TRUE,'now()','230000'),
  ('billing_payments','amount_refunded_paise','bigint',TRUE,'0','311700'),
  ('billing_webhook_events','id','uuid',TRUE,'extensions.uuid_generate_v4()','230000'),
  ('billing_webhook_events','provider','text',TRUE,'''razorpay''::text','230000'),
  ('billing_webhook_events','provider_event_id','text',TRUE,'<none>','230000'),
  ('billing_webhook_events','event_type','text',TRUE,'<none>','230000'),
  ('billing_webhook_events','payload_sha256','character(64)',TRUE,'<none>','230000'),
  ('billing_webhook_events','processing_status','text',TRUE,'''received''::text','230000'),
  ('billing_webhook_events','received_at','timestamp with time zone',TRUE,'now()','230000'),
  ('billing_webhook_events','processing_started_at','timestamp with time zone',FALSE,'<none>','230000'),
  ('billing_webhook_events','processed_at','timestamp with time zone',FALSE,'<none>','230000'),
  ('organization_pilot_entitlements','id','uuid',TRUE,'extensions.uuid_generate_v4()','pilot'),
  ('organization_pilot_entitlements','organization_id','uuid',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlements','granted_by','uuid',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlements','granted_at','timestamp with time zone',TRUE,'statement_timestamp()','pilot'),
  ('organization_pilot_entitlements','expires_at','timestamp with time zone',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlements','grant_reason','text',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlements','revoked_by','uuid',FALSE,'<none>','pilot'),
  ('organization_pilot_entitlements','revoked_at','timestamp with time zone',FALSE,'<none>','pilot'),
  ('organization_pilot_entitlements','revoke_reason','text',FALSE,'<none>','pilot'),
  ('organization_pilot_entitlement_events','id','uuid',TRUE,'extensions.uuid_generate_v4()','pilot'),
  ('organization_pilot_entitlement_events','organization_id','uuid',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlement_events','entitlement_id','uuid',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlement_events','actor_profile_id','uuid',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlement_events','action','text',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlement_events','reason','text',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlement_events','expires_at','timestamp with time zone',TRUE,'<none>','pilot'),
  ('organization_pilot_entitlement_events','occurred_at','timestamp with time zone',TRUE,'statement_timestamp()','pilot')
), actual_columns AS (
  SELECT e.*, c.oid AS table_oid, a.attnum,
         CASE WHEN a.attnum IS NOT NULL THEN pg_catalog.format_type(a.atttypid,a.atttypmod) END AS actual_type,
         a.attnotnull AS actual_not_null,
         COALESCE(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'<none>') AS actual_default
    FROM expected_columns e
    LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.' || e.table_name)
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=e.column_name
      AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
)
SELECT 'S05_COLUMN:' || table_name || '.' || column_name AS check_name,
       CASE WHEN table_oid IS NULL OR attnum IS NULL THEN 'MISSING'
            WHEN actual_type<>type_name OR actual_not_null<>is_not_null OR actual_default<>default_expr THEN 'FAIL'
            ELSE 'PASS' END AS result,
       COALESCE(actual_type,'table/column absent') || '; not_null=' || COALESCE(actual_not_null::text,'?') || '; default=' || actual_default AS actual_value,
       type_name || '; not_null=' || is_not_null::text || '; default=' || default_expr AS expected_value,
       source_migration
  FROM actual_columns ORDER BY table_name,column_name;

-- S05B: complete current column sets (names/definitions only; no row data).
SELECT 'S05_COLUMN_SET:' || c.relname AS check_name,
       'REVIEW_REQUIRED'::text AS result,
       pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
         'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
         'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)
       ) ORDER BY a.attnum)::text AS actual_columns,
       'Compare full column set with the listed source migrations; extra columns are not automatically treated as conflicts.'::text AS expected_value
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relname IN ('organizations','profiles','organization_invitations','pending_registrations','phone_otps','email_otps','registration_otp_attempts','organization_subscriptions','billing_payments','billing_webhook_events','organization_pilot_entitlements','organization_pilot_entitlement_events')
 GROUP BY c.relname ORDER BY c.relname;

-- SECTION 6: duplicate prechecks. Only counts are returned, never keys or rows.
WITH duplicate_checks(check_name, relation_name, column_name, aggregate_sql) AS (
  VALUES
    ('DUPLICATE_NORMALIZED_PROFILE_EMAILS','public.profiles','email',
     'SELECT count(*)::bigint AS duplicate_groups FROM (SELECT lower(email) FROM public.profiles WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1) d'),
    ('DUPLICATE_NORMALIZED_PENDING_REGISTRATION_EMAILS','public.pending_registrations','email',
     'SELECT count(*)::bigint AS duplicate_groups FROM (SELECT lower(email) FROM public.pending_registrations WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1) d'),
    ('DUPLICATE_ORGANIZATION_OWNER_IDS','public.organizations','owner_id',
     'SELECT count(*)::bigint AS duplicate_groups FROM (SELECT owner_id FROM public.organizations WHERE owner_id IS NOT NULL GROUP BY owner_id HAVING count(*) > 1) d')
), evaluated AS (
  SELECT d.*,
         pg_catalog.to_regclass(d.relation_name) AS relation_oid,
         EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid=pg_catalog.to_regclass(d.relation_name)
                    AND a.attname=d.column_name AND a.attnum>0 AND NOT a.attisdropped) AS column_exists
    FROM duplicate_checks d
)
SELECT 'S06_' || check_name AS check_name,
       CASE WHEN relation_oid IS NULL OR NOT column_exists THEN 'MISSING'
            WHEN duplicate_groups=0 THEN 'PASS' ELSE 'FAIL' END AS result,
       CASE WHEN relation_oid IS NULL THEN 'required relation absent'
            WHEN NOT column_exists THEN 'required column absent'
            ELSE 'duplicate_groups=' || duplicate_groups::text END AS actual_value,
       'duplicate_groups=0; aggregate count only'::text AS expected_value
  FROM evaluated e
 CROSS JOIN LATERAL (
   SELECT CASE WHEN e.relation_oid IS NOT NULL AND e.column_exists THEN
     COALESCE(((pg_catalog.xpath('/table/row/duplicate_groups/text()',
       pg_catalog.query_to_xml(e.aggregate_sql,TRUE,FALSE,'')))[1])::text,'0')::bigint
   END AS duplicate_groups
 ) a;

-- SECTION 7: expected indexes and constraints, exact catalog definitions.
WITH expected_indexes(table_name,index_name,is_unique,key_columns,predicate_hint,source_migration) AS (
  VALUES
    ('profiles','profiles_email_unique_lower',TRUE,'lower(email)','email IS NOT NULL','300000'),
    ('organizations','organizations_owner_id_unique',TRUE,'owner_id','<none>','300000'),
    ('leads','idx_leads_org_assigned',FALSE,'organization_id, assigned_to','<none>','010000'),
    ('leads','idx_leads_org_status',FALSE,'organization_id, status','<none>','010000'),
    ('calls','idx_calls_org_telecaller',FALSE,'organization_id, telecaller_id','<none>','010000'),
    ('calls','idx_calls_lead',FALSE,'lead_id','<none>','010000'),
    ('follow_ups','idx_follow_ups_sched',FALSE,'assigned_to, scheduled_at, status','<none>','010000'),
    ('activity_logs','idx_activity_org_created',FALSE,'organization_id, created_at','<none>','010000'),
    ('security_events','idx_security_org_severity',FALSE,'organization_id, severity, created_at','<none>','010000'),
    ('notifications','idx_notifications_user_read',FALSE,'user_id, read','<none>','010000'),
    ('profiles','idx_profiles_phone',FALSE,'phone','<none>','070000'),
    ('profiles','idx_profiles_phone_verified',FALSE,'phone_verified','<none>','070000'),
    ('profiles','idx_profiles_email',FALSE,'email','<none>','080000'),
    ('profiles','idx_profiles_email_verified',FALSE,'email_verified','<none>','080000'),
    ('organization_invitations','idx_org_invitations_org_status',FALSE,'organization_id, status','<none>','070000'),
    ('organization_invitations','idx_org_invitations_token',FALSE,'token','<none>','070000'),
    ('organization_invitations','idx_org_invitations_phone',FALSE,'phone_number','<none>','070000'),
    ('pending_registrations','idx_pending_reg_phone',FALSE,'phone_number','<none>','070000'),
    ('pending_registrations','idx_pending_reg_expires',FALSE,'expires_at','<none>','070000'),
    ('organization_subscriptions','organization_subscriptions_one_current_per_org',TRUE,'organization_id','is_current','230000'),
    ('organization_subscriptions','organization_subscriptions_status_period_end',FALSE,'status, current_period_end','<none>','230000'),
    ('billing_payments','billing_payments_org_created',FALSE,'organization_id, created_at','<none>','230000'),
    ('billing_payments','billing_payments_subscription_created',FALSE,'subscription_id, created_at','<none>','230000'),
    ('billing_payments','billing_payments_verified_subscription_period',FALSE,'subscription_id, paid_at','captured and verified','311700'),
    ('phone_otps','idx_phone_otps_phone_purpose',FALSE,'phone_number, purpose, used','<none>','070000'),
    ('phone_otps','idx_phone_otps_expires',FALSE,'expires_at','<none>','070000'),
    ('email_otps','idx_email_otps_lookup',FALSE,'email, purpose, created_at','<none>','080000'),
    ('email_otps','idx_email_otps_expires',FALSE,'expires_at','<none>','080000'),
    ('organization_invitations','idx_org_invitations_email',FALSE,'email','<none>','080000'),
    ('pending_registrations','idx_pending_reg_email',FALSE,'email','<none>','080000')
), found AS (
  SELECT e.*, ix.oid AS index_oid, t.oid AS table_oid, i.indisunique, i.indisvalid, i.indisready,
         pg_catalog.pg_get_indexdef(ix.oid) AS definition,
         CASE WHEN i.indexrelid IS NOT NULL THEN (
           SELECT pg_catalog.string_agg(a.attname::text,', ' ORDER BY k.pos)
             FROM pg_catalog.generate_series(0,i.indnkeyatts-1) k(pos)
             JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[k.pos]
         ) END AS key_columns_actual,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_class any_ix JOIN pg_catalog.pg_namespace n ON n.oid=any_ix.relnamespace
            WHERE n.nspname='public' AND any_ix.relname=e.index_name
         ) AS name_in_public
    FROM expected_indexes e
    LEFT JOIN pg_catalog.pg_class t ON t.oid=pg_catalog.to_regclass('public.' || e.table_name)
    LEFT JOIN pg_catalog.pg_class ix ON ix.relnamespace='public'::pg_catalog.regnamespace AND ix.relname=e.index_name AND ix.relkind='i'
    LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=ix.oid AND i.indrelid=t.oid
)
SELECT 'S07_INDEX:' || table_name || '.' || index_name AS check_name,
       CASE WHEN table_oid IS NULL THEN 'MISSING'
            WHEN index_oid IS NULL AND name_in_public THEN 'FAIL'
            WHEN index_oid IS NULL THEN 'MISSING'
            WHEN NOT indisvalid OR NOT indisready OR indisunique<>is_unique
              OR (index_name='profiles_email_unique_lower' AND (pg_catalog.lower(definition) NOT LIKE '%lower(email)%' OR pg_catalog.lower(definition) NOT LIKE '%email is not null%'))
              OR (index_name<>'profiles_email_unique_lower' AND key_columns_actual<>key_columns) THEN 'FAIL'
            WHEN definition IS NOT NULL THEN 'REVIEW_REQUIRED' END AS result,
       COALESCE(definition,'index absent') AS actual_value,
       'keys=' || key_columns || '; unique=' || is_unique::text || '; predicate=' || predicate_hint AS expected_value,
       source_migration
  FROM found ORDER BY table_name,index_name;

-- S07B: named constraint checks and catalog definitions.
WITH expected_constraints(table_name,constraint_name,constraint_type,source_migration) AS (
  VALUES
    ('organizations','organizations_pkey','p','010000'),
    ('organizations','organizations_slug_key','u','010000'),
    ('profiles','profiles_pkey','p','010000'),
    ('profiles','profiles_user_id_key','u','010000'),
    ('profiles','profiles_organization_id_fkey','f','010000'),
    ('profiles','profiles_role_check','c','010000'),
    ('profiles','profiles_status_check','c','070000'),
    ('organization_invitations','organization_invitations_pkey','p','070000'),
    ('organization_invitations','organization_invitations_role_check','c','070000'),
    ('organization_invitations','organization_invitations_status_check','c','070000'),
    ('organization_invitations','organization_invitations_token_key','u','070000'),
    ('organization_invitations','organization_invitations_organization_id_fkey','f','070000'),
    ('organization_invitations','organization_invitations_invited_by_fkey','f','070000'),
    ('pending_registrations','pending_registrations_pkey','p','070000'),
    ('pending_registrations','pending_registrations_email_key','u','080000'),
    ('phone_otps','phone_otps_pkey','p','070000'),
    ('phone_otps','phone_otps_purpose_check','c','070000'),
    ('email_otps','email_otps_pkey','p','080000'),
    ('email_otps','email_otps_purpose_check','c','080000'),
    ('registration_otp_attempts','registration_otp_attempts_pkey','p','310000'),
    ('registration_otp_attempts','registration_otp_attempts_attempts_check','c','310000'),
    ('organization_subscriptions','organization_subscriptions_pkey','p','230000'),
    ('organization_subscriptions','organization_subscriptions_organization_id_fkey','f','230000'),
    ('organization_subscriptions','organization_subscriptions_plan_code_check','c','230000'),
    ('organization_subscriptions','organization_subscriptions_status_check','c','230000'),
    ('organization_subscriptions','organization_subscriptions_entitlement_source_check','c','230000'),
    ('organization_subscriptions','organization_subscriptions_checkout_creation_status_check','c','230000'),
    ('organization_subscriptions','organization_subscriptions_amount_paise_check','c','230000'),
    ('organization_subscriptions','organization_subscriptions_checkout_idempotency_key_key','u','230000'),
    ('organization_subscriptions','organization_subscriptions_razorpay_subscription_id_key','u','230000'),
    ('organization_subscriptions','organization_subscriptions_period_order','c','230000'),
    ('organization_subscriptions','organization_subscriptions_id_organization_unique','u','230000'),
    ('organization_subscriptions','organization_subscriptions_amount_required','c','310000'),
    ('organization_subscriptions','organization_subscriptions_total_count_positive','c','311700'),
    ('billing_payments','billing_payments_pkey','p','230000'),
    ('billing_payments','billing_payments_organization_id_fkey','f','230000'),
    ('billing_payments','billing_payments_provider_check','c','230000'),
    ('billing_payments','billing_payments_amount_paise_check','c','230000'),
    ('billing_payments','billing_payments_currency_check','c','230000'),
    ('billing_payments','billing_payments_status_check','c','230000'),
    ('billing_payments','billing_payments_idempotency_key_key','u','230000'),
    ('billing_payments','billing_payments_razorpay_payment_id_key','u','230000'),
    ('billing_payments','billing_payments_subscription_organization_fkey','f','230000'),
    ('billing_payments','billing_payments_subscription_required','c','310000'),
    ('billing_payments','billing_payments_status_timestamps','c','310000'),
    ('billing_payments','billing_payments_refund_amount_valid','c','311700'),
    ('billing_payments','billing_payments_refund_status_valid','c','311700'),
    ('billing_webhook_events','billing_webhook_events_pkey','p','230000'),
    ('billing_webhook_events','billing_webhook_events_payload_sha256_check','c','230000'),
    ('billing_webhook_events','billing_webhook_events_processing_status_check','c','230000'),
    ('billing_webhook_events','billing_webhook_events_provider_event_unique','u','230000'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_pkey','p','pilot'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_expiry_check','c','pilot'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_revocation_check','c','pilot'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_organization_id_fkey','f','pilot'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_granted_by_fkey','f','pilot'),
    ('organization_pilot_entitlements','organization_pilot_entitlements_revoked_by_fkey','f','pilot'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_pkey','p','pilot'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_action_check','c','pilot'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_organization_id_fkey','f','pilot'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_entitlement_id_fkey','f','pilot'),
    ('organization_pilot_entitlement_events','organization_pilot_entitlement_events_actor_profile_id_fkey','f','pilot')
), found AS (
  SELECT e.*, c.oid AS table_oid, k.oid AS constraint_oid, k.contype, k.convalidated,
         pg_catalog.pg_get_constraintdef(k.oid,TRUE) AS definition
    FROM expected_constraints e
    LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.' || e.table_name)
    LEFT JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid AND k.conname=e.constraint_name
)
SELECT 'S07_CONSTRAINT:' || table_name || '.' || constraint_name AS check_name,
       CASE WHEN table_oid IS NULL OR constraint_oid IS NULL THEN 'MISSING'
            WHEN contype<>constraint_type OR NOT convalidated THEN 'FAIL' ELSE 'REVIEW_REQUIRED' END AS result,
       COALESCE(definition,'constraint absent') AS actual_value,
       'type=' || constraint_type || '; validated=true; manually compare exact definition with source' AS expected_value,
       source_migration
  FROM found ORDER BY table_name,constraint_name;

-- SECTION 8: duplicate-name conflicts in the public namespace. Existing exact
-- targets need manual comparison; wrong object kinds/parents are hard conflicts.
WITH expected_names(object_kind,object_name,parent_table,creation_mode) AS (
  VALUES
    ('TABLE','organization_subscriptions',NULL,'CREATE'),('TABLE','billing_payments',NULL,'CREATE'),
    ('TABLE','billing_webhook_events',NULL,'CREATE'),('TABLE','registration_otp_attempts',NULL,'CREATE TABLE IF NOT EXISTS'),
    ('TABLE','organization_pilot_entitlements',NULL,'CREATE'),('TABLE','organization_pilot_entitlement_events',NULL,'CREATE'),
    ('INDEX','profiles_email_unique_lower','profiles','IF NOT EXISTS'),('INDEX','organizations_owner_id_unique','organizations','IF NOT EXISTS'),
    ('INDEX','organization_subscriptions_one_current_per_org','organization_subscriptions','CREATE'),
    ('INDEX','organization_subscriptions_status_period_end','organization_subscriptions','CREATE'),
    ('INDEX','billing_payments_org_created','billing_payments','CREATE'),('INDEX','billing_payments_subscription_created','billing_payments','CREATE'),
    ('INDEX','billing_payments_verified_subscription_period','billing_payments','CREATE'),
    ('INDEX','organization_pilot_entitlements_active_org_idx','organization_pilot_entitlements','CREATE')
), actual AS (
  SELECT e.*, c.oid, c.relkind::text AS actual_kind, parent.relname AS actual_parent
    FROM expected_names e
    LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::pg_catalog.regnamespace AND c.relname=e.object_name
    LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=c.oid
    LEFT JOIN pg_catalog.pg_class parent ON parent.oid=i.indrelid
)
SELECT 'S08_NAME_CONFLICT:' || object_kind || ':' || object_name AS check_name,
       CASE WHEN oid IS NULL THEN 'PASS'
            WHEN object_kind='TABLE' AND actual_kind='r' THEN 'REVIEW_REQUIRED'
            WHEN object_kind='INDEX' AND actual_kind='i' AND actual_parent=parent_table THEN 'REVIEW_REQUIRED'
            ELSE 'FAIL' END AS result,
       COALESCE('kind=' || actual_kind || '; parent=' || actual_parent,'name absent') AS actual_value,
       'absent for fresh creation, or exact definition reviewed before reuse; mode=' || creation_mode AS expected_value
  FROM actual ORDER BY object_kind,object_name;

-- SECTION 9: RLS, policies, relation ACLs, and function metadata/permissions.
SELECT 'S09_RLS:' || c.relname AS check_name,
       CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END AS result,
       'enabled=' || c.relrowsecurity::text || '; forced=' || c.relforcerowsecurity::text AS actual_value,
       'RLS enabled; compare force flag with source and later migrations'::text AS expected_value
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('organizations','profiles','organization_invitations','pending_registrations','phone_otps','email_otps','registration_otp_attempts','organization_subscriptions','billing_payments','billing_webhook_events','organization_pilot_entitlements','organization_pilot_entitlement_events')
 ORDER BY c.relname;

WITH expected_policy_tables(table_name) AS (
  VALUES ('organizations'),('profiles'),('organization_invitations'),('pending_registrations'),
         ('phone_otps'),('email_otps'),('registration_otp_attempts'),('organization_subscriptions'),
         ('billing_payments'),('billing_webhook_events'),('organization_pilot_entitlements'),
         ('organization_pilot_entitlement_events')
)
SELECT 'S09_POLICIES:public.' || e.table_name AS check_name,
       CASE WHEN c.oid IS NULL THEN 'MISSING' ELSE 'REVIEW_REQUIRED' END AS result,
       'policy_count=' || pg_catalog.count(p.policyname)::text || '; policies=' ||
        COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',p.policyname,'command',p.cmd,'roles',p.roles,'permissive',p.permissive,'using',p.qual,'check',p.with_check) ORDER BY p.policyname) FILTER (WHERE p.policyname IS NOT NULL)::text,'[]') AS actual_value,
       'Compare each policy name, role, command and expression with source; pilot tables should have no table policies'::text AS expected_value
  FROM expected_policy_tables e
  LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.' || e.table_name)
  LEFT JOIN pg_catalog.pg_policies p ON p.schemaname='public' AND p.tablename=e.table_name
 GROUP BY e.table_name,c.oid ORDER BY e.table_name;

-- S09C: effective table privileges for client and server roles.
SELECT 'S09_RELATION_ACL:' || n.nspname || '.' || c.relname AS check_name,
       'REVIEW_REQUIRED'::text AS result,
       COALESCE(c.relacl::text,'<default ACL>') AS stored_acl,
       'Review stored ACL and effective anon/authenticated/service_role rights'::text AS expected_value,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN pg_catalog.has_table_privilege('anon',c.oid,'SELECT')::text END AS anon_select,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN pg_catalog.has_table_privilege('anon',c.oid,'INSERT')::text END AS anon_insert,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN pg_catalog.has_table_privilege('anon',c.oid,'UPDATE')::text END AS anon_update,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN pg_catalog.has_table_privilege('anon',c.oid,'DELETE')::text END AS anon_delete,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')::text END AS authenticated_select,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT')::text END AS authenticated_insert,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE')::text END AS authenticated_update,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE')::text END AS authenticated_delete,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN pg_catalog.has_table_privilege('service_role',c.oid,'SELECT')::text END AS service_role_select,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN pg_catalog.has_table_privilege('service_role',c.oid,'INSERT')::text END AS service_role_insert,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN pg_catalog.has_table_privilege('service_role',c.oid,'UPDATE')::text END AS service_role_update,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN pg_catalog.has_table_privilege('service_role',c.oid,'DELETE')::text END AS service_role_delete,
       EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) x
                WHERE x.grantee=0 AND x.privilege_type<>'TRIGGER') AS public_acl_present
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('organizations','profiles','organization_invitations','pending_registrations','phone_otps','email_otps','registration_otp_attempts','organization_subscriptions','billing_payments','billing_webhook_events','organization_pilot_entitlements','organization_pilot_entitlement_events')
 ORDER BY c.relname;

WITH expected_functions(signature,expected_return,expected_args,expected_security,source_migration,creation_mode) AS (
  VALUES
    ('public.issue_registration_otp_ticket(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,text)','jsonb',ARRAY['p_ticket_id','p_email','p_otp_hash','p_expires_at','p_resend_after','p_phone_number','p_company_name','p_owner_name','p_industry','p_company_size','p_business_email','p_business_phone','p_business_location','p_website_url']::text[],TRUE,'310000','OR REPLACE'),
    ('public.get_registration_otp_attempts(uuid,text)','jsonb',ARRAY['p_ticket_id','p_email']::text[],TRUE,'310000','OR REPLACE'),
    ('public.complete_registration_otp_verification(uuid,text,boolean)','jsonb',ARRAY['p_ticket_id','p_email','p_is_valid']::text[],TRUE,'310000','OR REPLACE'),
    ('public.cancel_registration_otp_ticket(uuid,text)','boolean',ARRAY['p_ticket_id','p_email']::text[],TRUE,'310000','OR REPLACE'),
    ('public.create_owner_registration(uuid,text,text,text,text,text,text,text,text,text,text,text,uuid,timestamp with time zone)','jsonb',ARRAY['p_owner_user_id','p_email','p_full_name','p_phone','p_company_name','p_slug','p_industry','p_company_size','p_business_email','p_business_phone','p_business_location','p_website_url','p_ticket_id','p_ticket_expires_at']::text[],TRUE,'310000','OR REPLACE'),
    ('public.protect_billing_payment_identity()','trigger',ARRAY[]::text[],FALSE,'310000','OR REPLACE'),
    ('public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)','jsonb',ARRAY['p_organization_id','p_local_subscription_id','p_provider_subscription_id','p_payment_id','p_invoice_id','p_amount_paise','p_currency','p_payment_status','p_payment_created_at','p_amount_refunded_paise','p_provider_total_count','p_provider_subscription_status','p_current_period_start','p_current_period_end','p_provider_verified_at']::text[],TRUE,'311700','OR REPLACE'),
    ('public.organization_has_active_paid_entitlement(uuid)','boolean',ARRAY['p_organization_id']::text[],TRUE,'311800/pilot','CREATE then OR REPLACE'),
    ('public.grant_founding_pilot_entitlement(uuid,uuid,timestamp with time zone,text)','uuid',ARRAY['p_organization_id','p_granted_by','p_expires_at','p_reason']::text[],TRUE,'pilot','CREATE'),
    ('public.revoke_founding_pilot_entitlement(uuid,uuid,uuid,text)','boolean',ARRAY['p_organization_id','p_entitlement_id','p_revoked_by','p_reason']::text[],TRUE,'pilot','CREATE')
), actual AS (
  SELECT e.*, p.oid, p.prorettype, p.proargnames, p.prosecdef, p.proconfig, p.proacl, p.proowner,
         pg_catalog.pg_get_function_result(p.oid) AS actual_return,
         pg_catalog.pg_get_function_arguments(p.oid) AS actual_arguments,
         pg_catalog.pg_get_functiondef(p.oid) AS definition,
         l.lanname AS language_name,
         pg_catalog.pg_get_userbyid(p.proowner)::text AS function_owner,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='service_role') THEN pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_execute,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='anon') THEN pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated') THEN pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute,
         EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM expected_functions e LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
    LEFT JOIN pg_catalog.pg_language l ON l.oid=p.prolang
)
SELECT 'S09_FUNCTION:' || signature AS check_name,
       CASE WHEN oid IS NULL THEN 'MISSING'
            WHEN actual_return<>expected_return OR proargnames<>expected_args THEN 'FAIL'
            WHEN prosecdef IS DISTINCT FROM expected_security OR NOT COALESCE(proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[],FALSE) THEN 'FAIL'
            WHEN expected_security AND (NOT service_execute OR anon_execute OR authenticated_execute OR public_execute) THEN 'FAIL'
            ELSE 'REVIEW_REQUIRED' END AS result,
       COALESCE(actual_arguments || ' RETURNS ' || actual_return,'function absent') || '; language=' || COALESCE(language_name,'?') || '; SECURITY DEFINER=' || COALESCE(prosecdef::text,'?') || '; config=' || COALESCE(proconfig::text,'[]') || '; owner=' || COALESCE(function_owner,'?') || '; service_role=' || COALESCE(service_execute::text,'?') || '; anon=' || COALESCE(anon_execute::text,'?') || '; authenticated=' || COALESCE(authenticated_execute::text,'?') || '; PUBLIC=' || COALESCE(public_execute::text,'?') AS actual_value,
       'return=' || expected_return || '; args=' || expected_args::text || '; SECURITY DEFINER=' || expected_security::text || '; mode=' || creation_mode AS expected_value,
       COALESCE(definition,'<function absent>') AS function_definition,
       source_migration
  FROM actual ORDER BY signature;

-- S09E: same-signature functions that could collide or be removed.
WITH expected_function_names(signature,operation) AS (
  VALUES
    ('public.grant_founding_pilot_entitlement(uuid,uuid,timestamp with time zone,text)','CREATE'),
    ('public.revoke_founding_pilot_entitlement(uuid,uuid,uuid,text)','CREATE'),
    ('public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)','OR REPLACE'),
    ('public.record_registration_otp_failure(uuid,text)','DROP IF EXISTS in 310000')
), found AS (
 SELECT signature,operation,pg_catalog.to_regprocedure(signature) AS proc_oid
   FROM expected_function_names
)
SELECT 'S09_FUNCTION_NAME_CONFLICT:' || signature AS check_name,
       CASE WHEN proc_oid IS NULL THEN 'PASS'
            ELSE 'REVIEW_REQUIRED' END AS result,
       CASE WHEN proc_oid IS NULL THEN 'exact signature absent'
            ELSE pg_catalog.pg_get_functiondef(proc_oid) END AS actual_value,
       'operation=' || operation || '; compare exact definition and history before any replacement/removal' AS expected_value
  FROM found ORDER BY signature;

-- Trigger catalog and definition output covers triggers on all prerequisite
-- tables, without reading their rows.
SELECT 'S09_TRIGGER:' || n.nspname || '.' || c.relname || '.' || t.tgname AS check_name,
       'REVIEW_REQUIRED'::text AS result,
       pg_catalog.pg_get_triggerdef(t.oid,TRUE) AS trigger_definition,
       pg_catalog.pg_get_functiondef(t.tgfoid) AS trigger_function_definition
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname='public'
   AND c.relname IN ('organizations','profiles','organization_invitations','pending_registrations','phone_otps','email_otps','registration_otp_attempts','organization_subscriptions','billing_payments','billing_webhook_events','organization_pilot_entitlements','organization_pilot_entitlement_events')
 ORDER BY c.relname,t.tgname;

SELECT 'S09_TRIGGER:public.billing_payments.protect_billing_payment_identity'::text AS check_name,
       CASE WHEN c.oid IS NULL THEN 'MISSING'
            WHEN t.oid IS NULL THEN 'MISSING' ELSE 'REVIEW_REQUIRED' END AS result,
       COALESCE(pg_catalog.pg_get_triggerdef(t.oid,TRUE),'expected trigger absent') AS trigger_definition,
       COALESCE(pg_catalog.pg_get_functiondef(t.tgfoid),'trigger function absent') AS trigger_function_definition
  FROM (SELECT pg_catalog.to_regclass('public.billing_payments') AS oid) r
  LEFT JOIN pg_catalog.pg_class c ON c.oid=r.oid
  LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid AND t.tgname='protect_billing_payment_identity' AND NOT t.tgisinternal;

-- SECTION 10: readiness matrix. PASS means migration prerequisites and known
-- name conflicts permit review for execution; it is not authorization to run.
WITH catalog AS (
  SELECT
    pg_catalog.to_regclass('public.organizations') IS NOT NULL AS organizations,
    pg_catalog.to_regclass('public.profiles') IS NOT NULL AS profiles,
    pg_catalog.to_regclass('public.pending_registrations') IS NOT NULL AS pending_regs,
    pg_catalog.to_regclass('public.organization_invitations') IS NOT NULL AS invitations,
    pg_catalog.to_regclass('public.phone_otps') IS NOT NULL AS phone_otps,
    pg_catalog.to_regclass('public.email_otps') IS NOT NULL AS email_otps,
    pg_catalog.to_regclass('public.organization_subscriptions') IS NOT NULL AS subscriptions,
    pg_catalog.to_regclass('public.billing_payments') IS NOT NULL AS payments,
    pg_catalog.to_regclass('public.billing_webhook_events') IS NOT NULL AS webhook_events,
    pg_catalog.to_regclass('public.registration_otp_attempts') IS NOT NULL AS registration_attempts,
    pg_catalog.to_regprocedure('extensions.uuid_generate_v4()') IS NOT NULL AS uuid_fn,
    pg_catalog.to_regprocedure('public.organization_has_active_paid_entitlement(uuid)') IS NOT NULL AS entitlement_fn,
    pg_catalog.to_regprocedure('public.grant_founding_pilot_entitlement(uuid,uuid,timestamp with time zone,text)') IS NOT NULL AS pilot_grant_fn,
    pg_catalog.to_regprocedure('public.revoke_founding_pilot_entitlement(uuid,uuid,uuid,text)') IS NOT NULL AS pilot_revoke_fn,
    pg_catalog.to_regprocedure('public.get_auth_role()') IS NOT NULL AS get_auth_role_fn,
    pg_catalog.to_regprocedure('public.get_auth_org_id()') IS NOT NULL AS get_auth_org_id_fn,
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.profiles') AND a.attname='email' AND a.attnum>0 AND NOT a.attisdropped) AS profile_email_column,
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.profiles') AND a.attname='phone_verified' AND a.attnum>0 AND NOT a.attisdropped) AS profile_phone_verified_column,
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.organizations') AND a.attname IN ('business_email','business_phone','business_location','website_url') AND a.attnum>0 AND NOT a.attisdropped) AS organization_business_columns,
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.pending_registrations') AND a.attname IN ('business_email','business_phone','business_location','website_url') AND a.attnum>0 AND NOT a.attisdropped) AS pending_business_columns,
    EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass('public.billing_payments') AND t.tgname='protect_billing_payment_identity' AND NOT t.tgisinternal) AS payment_identity_trigger,
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.billing_payments') AND a.attname='amount_refunded_paise' AND a.atttypid='pg_catalog.int8'::pg_catalog.regtype AND a.attnotnull AND NOT a.attisdropped) AS refund_column,
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.organization_subscriptions') AND a.attname='razorpay_total_count' AND a.atttypid='pg_catalog.int4'::pg_catalog.regtype AND NOT a.attisdropped) AS total_count_column,
    pg_catalog.to_regclass('public.organization_pilot_entitlements') IS NOT NULL AS pilot_table,
    pg_catalog.to_regclass('public.organization_pilot_entitlement_events') IS NOT NULL AS pilot_events,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class x JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace
             WHERE n.nspname='public' AND x.relname IN ('organization_subscriptions_one_current_per_org','organization_subscriptions_status_period_end','billing_payments_org_created','billing_payments_subscription_created')) AS billing_foundation_index_name,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class x JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace
             WHERE n.nspname='public' AND x.relname IN ('profiles_email_unique_lower','organizations_owner_id_unique')) AS owner_index_name,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class x JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace
             WHERE n.nspname='public' AND x.relname='billing_payments_verified_subscription_period') AS verified_index_name,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class x JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace
             WHERE n.nspname='public' AND x.relname='organization_pilot_entitlements_active_org_idx') AS pilot_index_name
), expected_versions(version) AS (
  VALUES ('20261001000000'),('20261007000000'),('20261008000000'),('20261023000000'),
         ('20261030000000'),('20261031000000'),('20261031170000'),('20261031180000'),('20261104120000')
), history_shape AS (
  SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS rel,
         EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid=pg_catalog.to_regclass('supabase_migrations.schema_migrations')
                    AND a.attname='version' AND a.atttypid IN ('pg_catalog.text'::pg_catalog.regtype,'pg_catalog.varchar'::pg_catalog.regtype,'pg_catalog.bpchar'::pg_catalog.regtype)
                    AND a.attnum>0 AND NOT a.attisdropped) AS has_version
), history_counts AS (
  SELECT v.version, hs.rel,
         CASE WHEN hs.rel IS NOT NULL AND hs.has_version THEN
           COALESCE(((pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml(
             'SELECT count(*)::bigint AS n FROM supabase_migrations.schema_migrations WHERE version = '
             || pg_catalog.quote_literal(v.version),TRUE,FALSE,'')))[1])::text,'0')::bigint
         END AS recorded_count
    FROM expected_versions v CROSS JOIN history_shape hs
), duplicate_counts AS (
  SELECT
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.profiles') AND a.attname='email' AND a.attnum>0 AND NOT a.attisdropped) THEN NULL ELSE
      (pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml('SELECT count(*) AS n FROM (SELECT lower(email) FROM public.profiles WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*)>1) d',TRUE,FALSE,'')))[1]::text::bigint END AS profile_email_groups,
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.organizations') AND a.attname='owner_id' AND a.attnum>0 AND NOT a.attisdropped) THEN NULL ELSE
      (pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml('SELECT count(*) AS n FROM (SELECT owner_id FROM public.organizations WHERE owner_id IS NOT NULL GROUP BY owner_id HAVING count(*)>1) d',TRUE,FALSE,'')))[1]::text::bigint END AS owner_groups,
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.pending_registrations') AND a.attname='email' AND a.attnum>0 AND NOT a.attisdropped) THEN NULL ELSE
      (pg_catalog.xpath('/table/row/n/text()',pg_catalog.query_to_xml('SELECT count(*) AS n FROM (SELECT lower(email) FROM public.pending_registrations WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*)>1) d',TRUE,FALSE,'')))[1]::text::bigint END AS pending_email_groups
) , ready(migration_version,migration_file,preconditions,recorded_count) AS (
  SELECT '20261001000000','20261001000000_init_leadvault.sql',
         CASE WHEN NOT organizations OR NOT profiles OR NOT uuid_fn THEN 'MISSING'
              ELSE 'REVIEW_REQUIRED' END, h.recorded_count FROM catalog CROSS JOIN history_counts h WHERE h.version='20261001000000'
  UNION ALL
  SELECT '20261007000000','20261007000000_otp_authentication_and_onboarding.sql',
         CASE WHEN NOT organizations OR NOT profiles OR NOT uuid_fn OR NOT get_auth_role_fn OR NOT get_auth_org_id_fn THEN 'MISSING'
              WHEN invitations OR pending_regs OR phone_otps OR profile_phone_verified_column THEN 'REVIEW_REQUIRED' ELSE 'PASS' END, h.recorded_count FROM catalog CROSS JOIN history_counts h WHERE h.version='20261007000000'
  UNION ALL
  SELECT '20261008000000','20261008000000_email_otp_authentication.sql',
         CASE WHEN NOT profiles OR NOT pending_regs OR NOT invitations THEN 'MISSING'
              WHEN pending_email_groups IS NULL THEN 'MISSING'
              WHEN pending_email_groups>0 THEN 'FAIL'
              WHEN email_otps OR profile_email_column THEN 'REVIEW_REQUIRED'
              ELSE 'PASS' END, h.recorded_count FROM catalog CROSS JOIN duplicate_counts CROSS JOIN history_counts h WHERE h.version='20261008000000'
  UNION ALL
  SELECT '20261023000000','20261023000000_billing_foundation.sql',
         CASE WHEN NOT organizations OR NOT uuid_fn THEN 'MISSING'
              WHEN subscriptions OR payments OR webhook_events OR billing_foundation_index_name THEN 'REVIEW_REQUIRED' ELSE 'PASS' END, h.recorded_count FROM catalog CROSS JOIN history_counts h WHERE h.version='20261023000000'
  UNION ALL
  SELECT '20261030000000','20261030000000_owner_business_billing_details.sql',
         CASE WHEN NOT organizations OR NOT profiles OR NOT pending_regs OR NOT profile_email_column THEN 'MISSING'
              WHEN profile_email_groups IS NULL OR owner_groups IS NULL THEN 'REVIEW_REQUIRED'
              WHEN profile_email_groups>0 OR owner_groups>0 THEN 'FAIL'
              WHEN organization_business_columns OR pending_business_columns OR owner_index_name THEN 'REVIEW_REQUIRED'
              ELSE 'PASS' END, h.recorded_count FROM catalog CROSS JOIN duplicate_counts CROSS JOIN history_counts h WHERE h.version='20261030000000'
  UNION ALL
  SELECT '20261031000000','20261031000000_onboarding_billing_integrity.sql',
         CASE WHEN NOT pending_regs OR NOT subscriptions OR NOT payments OR NOT organization_business_columns OR NOT pending_business_columns THEN 'MISSING'
              ELSE 'REVIEW_REQUIRED' END, h.recorded_count FROM catalog CROSS JOIN history_counts h WHERE h.version='20261031000000'
  UNION ALL
  SELECT '20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql',
         CASE WHEN NOT subscriptions OR NOT payments OR NOT payment_identity_trigger THEN 'MISSING'
              WHEN verified_index_name THEN 'REVIEW_REQUIRED'
              ELSE 'REVIEW_REQUIRED' END, h.recorded_count FROM catalog CROSS JOIN history_counts h WHERE h.version='20261031170000'
  UNION ALL
  SELECT '20261031180000','20261031180000_paid_subscription_entitlement_gate.sql',
         CASE WHEN NOT subscriptions OR NOT payments THEN 'MISSING'
              WHEN NOT refund_column OR NOT total_count_column THEN 'MISSING'
              WHEN entitlement_fn THEN 'FAIL' ELSE 'PASS' END, h.recorded_count FROM catalog CROSS JOIN history_counts h WHERE h.version='20261031180000'
  UNION ALL
  SELECT '20261104120000','20261104120000_founding_pilot_entitlements.sql',
         CASE WHEN NOT subscriptions OR NOT payments OR NOT entitlement_fn THEN 'MISSING'
              WHEN pilot_grant_fn OR pilot_revoke_fn THEN 'FAIL'
              WHEN pilot_table OR pilot_events OR pilot_index_name THEN 'REVIEW_REQUIRED' ELSE 'PASS' END, h.recorded_count FROM catalog CROSS JOIN history_counts h WHERE h.version='20261104120000'
)
SELECT 'S10_MIGRATION_READINESS:' || migration_version AS check_name,
       CASE WHEN recorded_count IS NULL THEN 'REVIEW_REQUIRED'
            WHEN recorded_count>1 THEN 'FAIL'
            WHEN recorded_count=1 THEN 'REVIEW_REQUIRED'
            ELSE preconditions END AS result,
       migration_file,
       CASE WHEN recorded_count IS NULL THEN 'migration ledger unavailable; manually reconcile before application'
            WHEN recorded_count>1 THEN 'duplicate history rows; stop and reconcile'
            WHEN recorded_count=1 THEN 'version already recorded; compare every effect and do not replay blindly'
            WHEN preconditions='PASS' THEN 'Known direct prerequisites present and no counted target collision; still require full definition review and approval.'
            WHEN preconditions='MISSING' THEN 'One or more required predecessor relations/functions are absent.'
            WHEN preconditions='FAIL' THEN 'A data precondition or exact target-name conflict exists; do not apply.'
            ELSE 'Existing/partially applied objects or a migration with broad replacements require manual catalog comparison.' END AS explanation
  FROM ready ORDER BY migration_version;

-- END: all outputs are metadata, function source, or aggregate counts only.
