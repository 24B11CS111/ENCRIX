-- Read-only preflight for Razorpay lifecycle migration 20261031170000.
-- Run only against the isolated local PostgreSQL 17 validation database.
BEGIN TRANSACTION READ ONLY;

SELECT 'RAZORPAY_PREFLIGHT_IDENTITY|database=' || current_database()
       || '|current_user=' || current_user || '|session_user=' || session_user
       || '|version=' || current_setting('server_version')
       || '|port=' || current_setting('port') AS preflight_identity;

DO $razorpay_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_count bigint;
  v_type text;
  v_not_null boolean;
  v_definition text;
  v_valid boolean;
  v_expected record;
  v_actual record;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port') <> '5432' THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: database identity is not the isolated postgres/PostgreSQL 17 container database');
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: Supabase migration history table is absent');
  ELSE
    IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'
          AND column_name IN ('version','statements','name')) <> 3
       OR (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='supabase_migrations' AND table_name='schema_migrations') <> 3
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations'
          AND table_name='schema_migrations' AND column_name='version' AND data_type='text' AND is_nullable='NO')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations'
          AND table_name='schema_migrations' AND column_name='statements' AND data_type='ARRAY' AND is_nullable='YES')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations'
          AND table_name='schema_migrations' AND column_name='name' AND data_type='text' AND is_nullable='YES')
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_constraint c
          WHERE c.conrelid='supabase_migrations.schema_migrations'::regclass AND c.contype='p'
            AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
              WHERE a.attrelid=c.conrelid AND a.attname='version' AND NOT a.attisdropped)]::smallint[]
       ) THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: migration history schema differs from version/statements/name with version primary key');
    END IF;
    FOR v_expected IN SELECT * FROM (VALUES
      ('20261023000000',1::bigint),
      ('20261030000000',1::bigint),
      ('20261031000000',1::bigint),
      ('20261031160000',1::bigint),
      ('20261031170000',0::bigint)
    ) AS h(version,expected_count)
    LOOP
      SELECT count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version=v_expected.version;
      RAISE NOTICE 'RAZORPAY_PREFLIGHT_HISTORY|version=%|actual=%|expected=%',v_expected.version,v_count,v_expected.expected_count;
      IF v_count <> v_expected.expected_count THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: migration history count mismatch for ' || v_expected.version);
      END IF;
    END LOOP;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
      WHERE e.extname='uuid-ossp' AND n.nspname='extensions') THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: uuid-ossp extension is not installed in extensions (required by regression fixtures/foundation)');
  END IF;

  IF pg_catalog.to_regclass('public.billing_payments') IS NULL
     OR pg_catalog.to_regclass('public.organization_subscriptions') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: billing foundation tables are missing');
  ELSE
    -- Every pre-existing column consumed by migration 170000 and its RPC.
    FOR v_expected IN SELECT * FROM (VALUES
      ('billing_payments','id','uuid',true),
      ('billing_payments','organization_id','uuid',true),
      ('billing_payments','subscription_id','uuid',false),
      ('billing_payments','provider','text',true),
      ('billing_payments','idempotency_key','text',true),
      ('billing_payments','razorpay_payment_id','text',false),
      ('billing_payments','razorpay_invoice_id','text',false),
      ('billing_payments','amount_paise','bigint',true),
      ('billing_payments','currency','text',true),
      ('billing_payments','status','text',true),
      ('billing_payments','signature_verified_at','timestamp with time zone',false),
      ('billing_payments','paid_at','timestamp with time zone',false),
      ('billing_payments','failed_at','timestamp with time zone',false),
      ('billing_payments','updated_at','timestamp with time zone',true),
      ('organization_subscriptions','id','uuid',true),
      ('organization_subscriptions','organization_id','uuid',true),
      ('organization_subscriptions','plan_code','text',true),
      ('organization_subscriptions','status','text',true),
      ('organization_subscriptions','entitlement_source','text',true),
      ('organization_subscriptions','is_current','boolean',true),
      ('organization_subscriptions','amount_paise','bigint',false),
      ('organization_subscriptions','razorpay_plan_id','text',false),
      ('organization_subscriptions','razorpay_subscription_id','text',false),
      ('organization_subscriptions','current_period_start','timestamp with time zone',false),
      ('organization_subscriptions','current_period_end','timestamp with time zone',false),
      ('organization_subscriptions','last_payment_at','timestamp with time zone',false),
      ('organization_subscriptions','cancelled_at','timestamp with time zone',false),
      ('organization_subscriptions','ended_at','timestamp with time zone',false),
      ('organization_subscriptions','updated_at','timestamp with time zone',true)
    ) AS c(table_name,column_name,expected_type,expected_not_null)
    LOOP
      SELECT pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull
        INTO v_type,v_not_null
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid=pg_catalog.to_regclass('public.' || v_expected.table_name)
         AND a.attname=v_expected.column_name AND a.attnum>0 AND NOT a.attisdropped;
      IF NOT FOUND OR v_type IS DISTINCT FROM v_expected.expected_type
         OR v_not_null IS DISTINCT FROM v_expected.expected_not_null THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: incompatible or missing prerequisite column public.'
          || v_expected.table_name || '.' || v_expected.column_name);
      END IF;
    END LOOP;

    -- New migration columns must be absent; any partial application requires review.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.billing_payments'::regclass
        AND attname='amount_refunded_paise' AND attnum>0 AND NOT attisdropped)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.organization_subscriptions'::regclass
        AND attname='razorpay_total_count' AND attnum>0 AND NOT attisdropped) THEN
      v_issues := pg_catalog.array_append(v_issues,'REVIEW: one or more migration target columns already exist; inspect their full definitions before replay');
    END IF;

    -- Required existing foundation/integrity constraints, including the tenant FK.
    FOR v_expected IN SELECT * FROM (VALUES
      ('billing_payments','billing_payments_subscription_organization_fkey','f'),
      ('billing_payments','billing_payments_subscription_required','c'),
      ('billing_payments','billing_payments_status_timestamps','c'),
      ('organization_subscriptions','organization_subscriptions_amount_required','c'),
      ('organization_subscriptions','organization_subscriptions_period_order','c'),
      ('organization_subscriptions','organization_subscriptions_id_organization_unique','u')
    ) AS k(table_name,constraint_name,constraint_type)
    LOOP
      SELECT c.contype,c.convalidated,pg_catalog.pg_get_constraintdef(c.oid) AS definition
        INTO v_actual FROM pg_catalog.pg_constraint c
       WHERE c.conrelid=pg_catalog.to_regclass('public.' || v_expected.table_name)
         AND c.conname=v_expected.constraint_name;
      IF NOT FOUND OR v_actual.contype IS DISTINCT FROM v_expected.constraint_type OR NOT v_actual.convalidated THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: required validated prerequisite constraint missing/incompatible: ' || v_expected.constraint_name);
      ELSE
        RAISE NOTICE 'RAZORPAY_PREFLIGHT_CONSTRAINT|name=%|validated=%|definition=%',v_expected.constraint_name,v_actual.convalidated,v_actual.definition;
        IF v_expected.constraint_name='billing_payments_subscription_required'
           AND pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%subscription_idisnotnull%'
           OR v_expected.constraint_name='billing_payments_status_timestamps'
           AND (pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%status<>''captured''%'
             OR pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%paid_atisnotnull%'
             OR pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%signature_verified_atisnotnull%'
             OR pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%status<>''failed''%'
             OR pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%failed_atisnotnull%')
           OR v_expected.constraint_name='organization_subscriptions_amount_required'
           AND (pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%entitlement_source<>''razorpay''%'
             OR pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%amount_paiseisnotnull%')
           OR v_expected.constraint_name='organization_subscriptions_period_order'
           AND (pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%current_period_endisnull%'
             OR pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%current_period_startisnull%'
             OR pg_catalog.lower(pg_catalog.regexp_replace(v_actual.definition,'\s+','','g')) NOT LIKE '%current_period_end>=current_period_start%') THEN
          v_issues := pg_catalog.array_append(v_issues,'BLOCKED: prerequisite constraint definition differs: ' || v_expected.constraint_name);
        END IF;
      END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.billing_payments'::regclass
          AND c.conname='billing_payments_subscription_organization_fkey'
          AND c.contype='f' AND c.convalidated AND c.confrelid='public.organization_subscriptions'::regclass
          AND c.confdeltype='r'
          AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)
              = ARRAY['subscription_id','organization_id']::text[]
          AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum)
              = ARRAY['id','organization_id']::text[]) THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: billing payment composite subscription/organization foreign key differs');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.organization_subscriptions'::regclass
          AND c.conname='organization_subscriptions_id_organization_unique' AND c.contype='u'
          AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)
              = ARRAY['id','organization_id']::text[]) THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: subscription composite unique key differs');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indrelid='public.billing_payments'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
          AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indpred IS NULL
          AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)
              = ARRAY['razorpay_payment_id']::text[]) THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: unique non-partial payment-ID index prerequisite is missing or incompatible');
    END IF;

    -- Ensure the payment identity/state trigger from migration 310000 is still active.
    SELECT t.tgenabled,t.tgtype,t.tgfoid,p.prosecdef,p.proconfig,
           pg_catalog.pg_get_functiondef(p.oid) AS function_definition
      INTO v_actual
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
     WHERE t.tgrelid='public.billing_payments'::regclass AND t.tgname='protect_billing_payment_identity'
       AND NOT t.tgisinternal AND p.oid=pg_catalog.to_regprocedure('public.protect_billing_payment_identity()');
    IF NOT FOUND OR v_actual.tgenabled <> 'O' OR v_actual.tgtype <> 19
       OR v_actual.prosecdef OR v_actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
       OR v_actual.function_definition NOT LIKE '%OLD.organization_id IS DISTINCT FROM NEW.organization_id%'
       OR v_actual.function_definition NOT LIKE '%OLD.subscription_id IS DISTINCT FROM NEW.subscription_id%'
       OR v_actual.function_definition NOT LIKE '%OLD.razorpay_payment_id IS NOT NULL%'
       OR v_actual.function_definition NOT LIKE '%billing_payment_status_transition_invalid%' THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: payment identity/state guard trigger or function differs from migration 310000');
    END IF;

    -- Preserve existing billing RLS and service-role paths; this migration must not rely on browser grants.
    IF NOT (SELECT relrowsecurity AND relowner='postgres'::regrole::oid FROM pg_catalog.pg_class WHERE oid='public.billing_payments'::regclass)
       OR NOT (SELECT relrowsecurity AND relowner='postgres'::regrole::oid FROM pg_catalog.pg_class WHERE oid='public.organization_subscriptions'::regclass)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
          WHERE c.oid IN ('public.billing_payments'::regclass,'public.organization_subscriptions'::regclass)
            AND acl.grantee IN (0,'anon'::regrole::oid,'authenticated'::regrole::oid))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
          WHERE c.oid IN ('public.billing_payments'::regclass,'public.organization_subscriptions'::regclass)
            AND acl.grantee='service_role'::regrole::oid
            AND acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
       OR NOT (pg_catalog.has_table_privilege('service_role','public.billing_payments','SELECT')
          AND pg_catalog.has_table_privilege('service_role','public.billing_payments','INSERT')
          AND pg_catalog.has_table_privilege('service_role','public.billing_payments','UPDATE')
          AND pg_catalog.has_table_privilege('service_role','public.billing_payments','DELETE')
          AND pg_catalog.has_table_privilege('service_role','public.billing_payments','TRUNCATE')
          AND pg_catalog.has_table_privilege('service_role','public.billing_payments','REFERENCES')
          AND pg_catalog.has_table_privilege('service_role','public.billing_payments','TRIGGER')
          AND pg_catalog.has_table_privilege('service_role','public.billing_payments','MAINTAIN'))
       OR NOT (pg_catalog.has_table_privilege('service_role','public.organization_subscriptions','SELECT')
          AND pg_catalog.has_table_privilege('service_role','public.organization_subscriptions','INSERT')
          AND pg_catalog.has_table_privilege('service_role','public.organization_subscriptions','UPDATE')
          AND pg_catalog.has_table_privilege('service_role','public.organization_subscriptions','DELETE')
          AND pg_catalog.has_table_privilege('service_role','public.organization_subscriptions','TRUNCATE')
          AND pg_catalog.has_table_privilege('service_role','public.organization_subscriptions','REFERENCES')
          AND pg_catalog.has_table_privilege('service_role','public.organization_subscriptions','TRIGGER')
          AND pg_catalog.has_table_privilege('service_role','public.organization_subscriptions','MAINTAIN')) THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: billing table ownership/RLS/effective grants do not match the existing service-role-only architecture');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.billing_payments'::regclass
        AND polname='Service role manages billing payments' AND polcmd='*'
        AND polroles=ARRAY['service_role'::regrole::oid] AND pg_catalog.pg_get_expr(polqual,polrelid)='true'
        AND pg_catalog.pg_get_expr(polwithcheck,polrelid)='true')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.organization_subscriptions'::regclass
        AND polname='Service role manages organization subscriptions' AND polcmd='*'
        AND polroles=ARRAY['service_role'::regrole::oid] AND pg_catalog.pg_get_expr(polqual,polrelid)='true'
        AND pg_catalog.pg_get_expr(polwithcheck,polrelid)='true') THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: required service-role billing RLS policies are missing');
    END IF;

    -- Data checks for pre-existing constraints and unique payment identity.
    EXECUTE $q$SELECT count(*) FROM public.billing_payments
      WHERE subscription_id IS NULL OR amount_paise <= 0 OR currency <> 'INR'
         OR (status='captured' AND (paid_at IS NULL OR signature_verified_at IS NULL))
         OR (status='failed' AND failed_at IS NULL)$q$ INTO v_count;
    IF v_count <> 0 THEN v_issues := pg_catalog.array_append(v_issues,'BLOCKED: billing_payments rows violate prerequisite integrity constraints'); END IF;
    EXECUTE $q$SELECT count(*) FROM (
      SELECT razorpay_payment_id FROM public.billing_payments
       WHERE razorpay_payment_id IS NOT NULL GROUP BY razorpay_payment_id HAVING count(*)>1
    ) d$q$ INTO v_count;
    IF v_count <> 0 THEN v_issues := pg_catalog.array_append(v_issues,'BLOCKED: duplicate non-null Razorpay payment IDs exist'); END IF;
    EXECUTE $q$SELECT count(*) FROM public.organization_subscriptions
      WHERE entitlement_source='razorpay' AND amount_paise IS NULL$q$ INTO v_count;
    IF v_count <> 0 THEN v_issues := pg_catalog.array_append(v_issues,'BLOCKED: Razorpay subscriptions have no amount'); END IF;
  END IF;

  -- Any target artifact means partial application or a same-name collision; never replay automatically.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname IN (
      'billing_payments_refund_amount_valid','billing_payments_refund_status_valid',
      'organization_subscriptions_total_count_positive')) THEN
    v_issues := pg_catalog.array_append(v_issues,'REVIEW: target constraint name already exists');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='billing_payments_verified_subscription_period') THEN
    v_issues := pg_catalog.array_append(v_issues,'REVIEW: target index name already exists');
  END IF;
  IF pg_catalog.to_regprocedure('public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='apply_verified_razorpay_payment') THEN
    v_issues := pg_catalog.array_append(v_issues,'REVIEW: target Razorpay RPC or overload already exists');
  END IF;

  IF pg_catalog.cardinality(v_issues)=0 THEN
    RAISE NOTICE 'RAZORPAY_PREFLIGHT_STATUS|PASS|history=160000:1,170000:0; prerequisites valid; target objects absent; data compatible';
    RAISE NOTICE 'RAZORPAY_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031170000';
  ELSE
    RAISE NOTICE 'RAZORPAY_PREFLIGHT_STATUS|BLOCKED|%',pg_catalog.array_to_string(v_issues,'; ');
    RAISE NOTICE 'RAZORPAY_PREFLIGHT_SAFE_TO_APPLY|FAIL|review required';
  END IF;
END;
$razorpay_preflight$;

ROLLBACK;
