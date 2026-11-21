-- Targeted, read-only preflight for 20261031160000_organization_twilio_calling.sql.
-- It deliberately does not run the broad pending-migration preflight.
BEGIN TRANSACTION READ ONLY;

SELECT 'DATABASE_IDENTITY' AS check_name,current_database() AS database_name,
       current_user AS role_name,current_setting('server_version') AS version,
       current_setting('port') AS port,inet_server_addr()::text AS server_address;
DO $identity$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN
    RAISE EXCEPTION 'PREFLIGHT_BLOCKED|FAIL|database identity is not the isolated local PostgreSQL 17 validation database';
  END IF;
END;
$identity$;

DO $twilio_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_count bigint;
  v_state_values text[];
  v_old_state_values text[] := ARRAY['PENDING','QUEUED','RINGING','IN_PROGRESS','COMPLETED','BUSY','NO_ANSWER','CANCELED','FAILED'];
BEGIN
  -- Only the immediate prerequisite and target history versions are classified.
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='supabase_migrations'
           AND table_name='schema_migrations' AND column_name IN ('version','statements','name'))<>3
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031150000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000')<>0 THEN
    v_issues:=pg_catalog.array_append(v_issues,'REVIEW: migration history schema or 150000/160000 counts differ from the required state');
  ELSE
    RAISE NOTICE 'TWILIO_PREFLIGHT_HISTORY|MATCHES_EXPECTED|150000=1|160000=0';
  END IF;

  -- Validate the specific relations/columns used by the migration and its RPCs.
  IF pg_catalog.to_regclass('public.organizations') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.leads') IS NULL
     OR pg_catalog.to_regclass('public.calls') IS NULL
     OR pg_catalog.to_regclass('public.call_bridges') IS NULL
     OR pg_catalog.to_regclass('public.activity_logs') IS NULL THEN
    v_issues:=pg_catalog.array_append(v_issues,'REVIEW: one or more existing Twilio dependency tables are absent');
  END IF;
  IF pg_catalog.to_regprocedure('extensions.uuid_generate_v4()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
       WHERE e.extname='uuid-ossp' AND n.nspname='extensions') THEN
    v_issues:=pg_catalog.array_append(v_issues,'REVIEW: extensions.uuid_generate_v4 or uuid-ossp in extensions is absent');
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('organizations','id','uuid'),
      ('profiles','id','uuid'),('profiles','organization_id','uuid'),('profiles','role','character varying(50)'),
      ('profiles','status','character varying(50)'),('profiles','phone_verified','boolean'),('profiles','phone','character varying(50)'),
      ('leads','id','uuid'),('leads','organization_id','uuid'),('leads','phone','character varying(50)'),
      ('leads','assigned_to','uuid'),('leads','status','character varying(50)'),
      ('calls','id','uuid'),('calls','organization_id','uuid'),('calls','lead_id','uuid'),
      ('calls','telecaller_id','uuid'),('calls','provider','character varying(50)'),('calls','provider_call_id','character varying(150)'),
      ('calls','status','character varying(50)'),
      ('call_bridges','call_id','uuid'),('call_bridges','organization_id','uuid'),
      ('call_bridges','telecaller_id','uuid'),('call_bridges','idempotency_key','uuid'),
      ('call_bridges','status','text'),('call_bridges','caller_leg_state','text'),
      ('call_bridges','customer_leg_state','text'),('call_bridges','customer_provider_call_id','character varying(34)'),
      ('call_bridges','caller_provider_call_id','character varying(34)'),
      ('activity_logs','organization_id','uuid'),('activity_logs','user_id','uuid'),
      ('activity_logs','action','character varying(100)'),('activity_logs','entity_type','character varying(100)'),
      ('activity_logs','entity_id','uuid'),('activity_logs','metadata','jsonb')
    ) AS expected(table_name,column_name,type_name)
    LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=expected.table_name
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=expected.column_name
      AND a.attnum>0 AND NOT a.attisdropped
    WHERE a.attname IS NULL OR pg_catalog.format_type(a.atttypid,a.atttypmod)<>expected.type_name
  ) THEN
    v_issues:=pg_catalog.array_append(v_issues,'REVIEW: dependency column missing or has incompatible type');
  END IF;
  IF pg_catalog.to_regclass('public.organizations') IS NOT NULL
     AND pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND pg_catalog.to_regclass('public.calls') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.organizations'::pg_catalog.regclass AND c.contype IN ('p','u')
          AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
            WHERE a.attrelid=c.conrelid AND a.attname='id' AND NOT a.attisdropped)]::smallint[])
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.profiles'::pg_catalog.regclass AND c.contype IN ('p','u')
          AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
            WHERE a.attrelid=c.conrelid AND a.attname='id' AND NOT a.attisdropped)]::smallint[])
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.calls'::pg_catalog.regclass AND c.contype IN ('p','u')
          AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
            WHERE a.attrelid=c.conrelid AND a.attname='id' AND NOT a.attisdropped)]::smallint[]) THEN
      v_issues:=pg_catalog.array_append(v_issues,'REVIEW: required referenced-key constraints are missing or incompatible');
    END IF;
  END IF;
  IF pg_catalog.to_regclass('public.call_bridges') IS NOT NULL
     AND pg_catalog.to_regclass('public.calls') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.call_bridges'::pg_catalog.regclass
          AND c.conname='call_bridges_telecaller_idempotency_key' AND c.contype='u' AND c.convalidated
          AND NOT c.condeferrable AND NOT c.condeferred
          AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)
              = ARRAY['organization_id','telecaller_id','idempotency_key']::text[])
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.call_bridges'::pg_catalog.regclass
          AND c.conname='call_bridges_calls_org_fkey' AND c.contype='f' AND c.convalidated
          AND c.confrelid='public.calls'::pg_catalog.regclass AND c.confdeltype='c' AND c.confupdtype='a'
          AND c.confmatchtype='s' AND NOT c.condeferrable AND NOT c.condeferred
          AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)
              = ARRAY['call_id','organization_id','telecaller_id']::text[]
          AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord)
              = ARRAY['id','organization_id','telecaller_id']::text[])
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.call_bridges'::pg_catalog.regclass
          AND c.conname='call_bridges_telecaller_org_fkey' AND c.contype='f' AND c.convalidated
          AND c.confrelid='public.profiles'::pg_catalog.regclass AND c.confdeltype='c' AND c.confupdtype='a'
          AND c.confmatchtype='s' AND NOT c.condeferrable AND NOT c.condeferred
          AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)
              = ARRAY['telecaller_id','organization_id']::text[]
          AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord)
              = ARRAY['id','organization_id']::text[])
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class x ON x.oid=i.indexrelid
        JOIN pg_catalog.pg_namespace xn ON xn.oid=x.relnamespace
        JOIN pg_catalog.pg_am am ON am.oid=x.relam
        WHERE xn.nspname='public' AND x.relname='calls_id_organization_telecaller_unique_idx'
          AND i.indrelid='public.calls'::pg_catalog.regclass
          AND i.indisunique AND i.indisvalid AND i.indisready
          AND i.indnatts=3 AND i.indnkeyatts=3 AND i.indpred IS NULL AND am.amname='btree'
          AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
            WHERE k.ord<=i.indnkeyatts ORDER BY k.ord)
              = ARRAY['id','organization_id','telecaller_id']::text[]) THEN
      v_issues:=pg_catalog.array_append(v_issues,'REVIEW: call bridge idempotency or composite tenant foreign-key prerequisite is missing');
    END IF;
  END IF;

  -- These relations are prerequisites, not evidence of migration 160000.
  -- Confirm exact pre-migration call_bridges state before its constraint is replaced.
  IF pg_catalog.to_regclass('public.call_bridges') IS NOT NULL THEN
    SELECT pg_catalog.array_agg(m.captures[1] ORDER BY m.ordinality) INTO v_state_values
      FROM pg_catalog.pg_constraint c
      CROSS JOIN LATERAL pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(c.oid),'''([A-Z_]+)''','g')
        WITH ORDINALITY AS m(captures,ordinality)
     WHERE c.conrelid='public.call_bridges'::regclass
       AND c.conname='call_bridges_customer_leg_state_check' AND c.contype='c' AND c.convalidated;
    IF v_state_values IS DISTINCT FROM v_old_state_values THEN
      v_issues:=pg_catalog.array_append(v_issues,'REVIEW: customer-leg state constraint is absent or not the exact reviewed pre-migration set');
    ELSE
      RAISE NOTICE 'TWILIO_PREFLIGHT_PREEXISTING|MATCHES_EXPECTED|call_bridges.customer_leg_state_check';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.call_bridges'::regclass
        AND attname='flow' AND attnum>0 AND NOT attisdropped)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.call_bridges'::regclass
        AND conname='call_bridges_flow_check') THEN
      v_issues:=pg_catalog.array_append(v_issues,'REVIEW: call_bridges.flow or its target constraint already exists');
    END IF;
    IF EXISTS (SELECT 1 FROM public.call_bridges WHERE customer_leg_state NOT IN
        ('PENDING','QUEUED','RINGING','IN_PROGRESS','COMPLETED','BUSY','NO_ANSWER','CANCELED','FAILED')) THEN
      v_issues:=pg_catalog.array_append(v_issues,'REVIEW: call_bridges contains state values outside the exact pre-migration constraint');
    END IF;
  END IF;

  -- Block duplicate provider SIDs before the migration creates its partial unique index.
  IF pg_catalog.to_regclass('public.calls') IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM (
      SELECT provider_call_id FROM public.calls
       WHERE provider='TWILIO' AND provider_call_id IS NOT NULL
       GROUP BY provider_call_id HAVING count(*)>1
    ) d;
    IF v_count>0 THEN
      v_issues:=pg_catalog.array_append(v_issues,'REVIEW: duplicate Twilio provider_call_id rows prevent the unique index');
    END IF;
  END IF;

  -- All migration-created objects must be absent; any partial or ambiguous target is REVIEW.
  IF pg_catalog.to_regclass('public.organization_twilio_credentials') IS NOT NULL
     OR pg_catalog.to_regclass('public.telephony_inbound_attempts') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace
       AND c.relname IN ('organization_twilio_active_phone_uidx','leads_org_phone_inbound_idx','calls_twilio_provider_call_id_uidx'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polname IN
       ('organization_twilio_service_role_only','telephony_inbound_attempts_service_role_only'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('save_organization_twilio_credentials',
        'revoke_organization_twilio_credentials','prepare_twilio_outbound_call','claim_twilio_customer_leg',
        'attach_twilio_leg_sid','record_twilio_inbound_attempt','prepare_twilio_inbound_call'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=pg_catalog.to_regclass('public.call_bridges')
       AND c.conname='call_bridges_flow_check') THEN
    v_issues:=pg_catalog.array_append(v_issues,'REVIEW: partial/already-present Twilio target object detected; do not apply or replay');
  END IF;

  -- Reject same-name index collisions on any relation in public, including a wrong-table index.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN
       ('organization_twilio_active_phone_uidx','leads_org_phone_inbound_idx','calls_twilio_provider_call_id_uidx')) THEN
    v_issues:=pg_catalog.array_append(v_issues,'REVIEW: same-name Twilio index exists and may conflict');
  END IF;

  IF pg_catalog.cardinality(v_issues)=0 THEN
    RAISE NOTICE 'MIGRATION|20261031160000|PASS|150000 recorded once; 160000 absent; dependencies valid; exact pre-state confirmed; no conflicts or target artifacts';
    RAISE NOTICE 'TWILIO_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031160000';
  ELSE
    RAISE NOTICE 'MIGRATION|20261031160000|REVIEW|%',pg_catalog.array_to_string(v_issues,'; ');
    RAISE NOTICE 'TWILIO_PREFLIGHT_SAFE_TO_APPLY|FAIL|review required';
  END IF;
END;
$twilio_preflight$;

ROLLBACK;
