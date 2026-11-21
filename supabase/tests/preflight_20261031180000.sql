-- Read-only, migration-specific preflight for paid entitlement gate 180000.
-- Run only inside the isolated local PostgreSQL 17 validation container.
BEGIN TRANSACTION READ ONLY;

SELECT 'ENTITLEMENT_PREFLIGHT_IDENTITY|database=' || current_database()
  || '|current_user=' || current_user || '|session_user=' || session_user
  || '|version=' || current_setting('server_version') || '|port=' || current_setting('port') AS identity;

DO $entitlement_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_count bigint;
  v_expected record;
  v_type text;
  v_not_null boolean;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port') <> '5432' THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: database identity is not the isolated local PostgreSQL 17 validation database');
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: Supabase migration history is absent');
  ELSE
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='supabase_migrations'
          AND table_name='schema_migrations' AND column_name IN ('version','statements','name')) <> 3
       OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='supabase_migrations'
          AND table_name='schema_migrations') <> 3
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations'
          AND table_name='schema_migrations' AND column_name='version' AND data_type='text' AND is_nullable='NO')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations'
          AND table_name='schema_migrations' AND column_name='statements' AND data_type='ARRAY' AND is_nullable='YES')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='supabase_migrations'
          AND table_name='schema_migrations' AND column_name='name' AND data_type='text' AND is_nullable='YES')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
          WHERE c.conrelid='supabase_migrations.schema_migrations'::regclass AND c.contype='p'
            AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.conrelid
              AND a.attname='version' AND NOT a.attisdropped)]::smallint[]) THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: migration history table does not match the expected version/statements/name schema');
    END IF;

    FOR v_expected IN SELECT * FROM (VALUES
      ('20261023000000',1::bigint), ('20261030000000',1::bigint),
      ('20261031000000',1::bigint), ('20261031160000',1::bigint),
      ('20261031170000',1::bigint), ('20261031180000',0::bigint)
    ) AS h(version,expected_count)
    LOOP
      SELECT count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version=v_expected.version;
      RAISE NOTICE 'ENTITLEMENT_PREFLIGHT_HISTORY|version=%|actual=%|expected=%',v_expected.version,v_count,v_expected.expected_count;
      IF v_count <> v_expected.expected_count THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: migration history count mismatch for ' || v_expected.version);
      END IF;
    END LOOP;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
      WHERE e.extname='uuid-ossp' AND n.nspname='extensions') THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: uuid-ossp in extensions is required by rollback-scoped SQL test fixtures');
  END IF;

  IF pg_catalog.to_regclass('public.organization_subscriptions') IS NULL
     OR pg_catalog.to_regclass('public.billing_payments') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: prerequisite billing tables are missing');
  ELSE
    FOR v_expected IN SELECT * FROM (VALUES
      ('organization_subscriptions','organization_id','uuid',true),
      ('organization_subscriptions','plan_code','text',true),
      ('organization_subscriptions','amount_paise','bigint',false),
      ('organization_subscriptions','entitlement_source','text',true),
      ('organization_subscriptions','status','text',true),
      ('organization_subscriptions','is_current','boolean',true),
      ('organization_subscriptions','checkout_creation_status','text',true),
      ('organization_subscriptions','razorpay_total_count','integer',false),
      ('organization_subscriptions','razorpay_subscription_id','text',false),
      ('organization_subscriptions','current_period_start','timestamp with time zone',false),
      ('organization_subscriptions','current_period_end','timestamp with time zone',false),
      ('billing_payments','organization_id','uuid',true),
      ('billing_payments','subscription_id','uuid',false),
      ('billing_payments','provider','text',true),
      ('billing_payments','amount_paise','bigint',true),
      ('billing_payments','amount_refunded_paise','bigint',true),
      ('billing_payments','currency','text',true),
      ('billing_payments','status','text',true),
      ('billing_payments','signature_verified_at','timestamp with time zone',false),
      ('billing_payments','paid_at','timestamp with time zone',false)
    ) AS c(table_name,column_name,expected_type,expected_not_null)
    LOOP
      SELECT pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull INTO v_type,v_not_null
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid=pg_catalog.to_regclass('public.' || v_expected.table_name)
         AND a.attname=v_expected.column_name AND a.attnum>0 AND NOT a.attisdropped;
      IF NOT FOUND OR v_type IS DISTINCT FROM v_expected.expected_type
         OR v_not_null IS DISTINCT FROM v_expected.expected_not_null THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: incompatible prerequisite column public.'
          || v_expected.table_name || '.' || v_expected.column_name);
      END IF;
    END LOOP;

    -- The function is read-only, but its correctness depends on these validated
    -- tenant, amount, refund and payment-state constraints from prior migrations.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.billing_payments'::regclass
         AND c.conname='billing_payments_subscription_organization_fkey' AND c.contype='f' AND c.convalidated
         AND c.confrelid='public.organization_subscriptions'::regclass
         AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
              JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['subscription_id','organization_id']::text[]
         AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
              JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum)=ARRAY['id','organization_id']::text[])
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.billing_payments'::regclass
         AND c.conname='billing_payments_refund_amount_valid' AND c.contype='c' AND c.convalidated
         AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g'))
             LIKE '%amount_refunded_paise>=0%'
         AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g'))
             LIKE '%amount_refunded_paise<=amount_paise%')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.billing_payments'::regclass
         AND c.conname='billing_payments_refund_status_valid' AND c.contype='c' AND c.convalidated
         AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g'))
             LIKE '%amount_refunded_paise=0%'
         AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g'))
             LIKE '%captured%refunded%')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.organization_subscriptions'::regclass
         AND c.conname='organization_subscriptions_amount_required' AND c.contype='c' AND c.convalidated
         AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g'))
             LIKE '%entitlement_source%razorpay%amount_paiseisnotnull%')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.organization_subscriptions'::regclass
         AND c.conname='organization_subscriptions_period_order' AND c.contype='c' AND c.convalidated
         AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g'))
             LIKE '%current_period_end>=current_period_start%') THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: validated billing tenant/refund/amount/period constraints are missing');
    END IF;

    EXECUTE $q$SELECT count(*) FROM public.billing_payments WHERE subscription_id IS NULL
       OR amount_paise <= 0 OR amount_refunded_paise < 0 OR amount_refunded_paise > amount_paise
       OR currency <> 'INR'
       OR (status='captured' AND (paid_at IS NULL OR signature_verified_at IS NULL))$q$ INTO v_count;
    IF v_count <> 0 THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: existing billing payment data violates entitlement prerequisites');
    END IF;
    EXECUTE $q$SELECT count(*) FROM public.organization_subscriptions
       WHERE entitlement_source='razorpay' AND (amount_paise IS NULL OR razorpay_total_count IS NOT NULL AND razorpay_total_count <= 0)$q$ INTO v_count;
    IF v_count <> 0 THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: existing Razorpay subscription amount or provider cycle count is invalid');
    END IF;

    IF NOT (SELECT relrowsecurity AND relowner='postgres'::regrole::oid
              FROM pg_catalog.pg_class WHERE oid='public.billing_payments'::regclass)
       OR NOT (SELECT relrowsecurity AND relowner='postgres'::regrole::oid
              FROM pg_catalog.pg_class WHERE oid='public.organization_subscriptions'::regclass) THEN
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: billing table owner/RLS assumptions differ from the reviewed service-role architecture');
    END IF;
  END IF;

  -- Any same-name function or overload is a conflict; do not overwrite or reconcile it.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='organization_has_active_paid_entitlement') THEN
    v_issues := pg_catalog.array_append(v_issues,'REVIEW: entitlement function name/signature already exists; inspect before proceeding');
  END IF;

  IF pg_catalog.cardinality(v_issues)=0 THEN
    RAISE NOTICE 'ENTITLEMENT_PREFLIGHT_STATUS|PASS|history=prerequisites-once,target-absent; dependencies valid; target function absent';
    RAISE NOTICE 'ENTITLEMENT_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031180000';
  ELSE
    RAISE NOTICE 'ENTITLEMENT_PREFLIGHT_STATUS|BLOCKED|%',pg_catalog.array_to_string(v_issues,'; ');
    RAISE NOTICE 'ENTITLEMENT_PREFLIGHT_SAFE_TO_APPLY|FAIL|review required';
  END IF;
END;
$entitlement_preflight$;

ROLLBACK;
