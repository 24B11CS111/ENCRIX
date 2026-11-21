-- Read-only, migration-specific preflight for follow-up email outbox 20261101090000.
-- Execute only in the isolated local PostgreSQL 17 validation container.
BEGIN TRANSACTION READ ONLY;

SELECT 'OUTBOX_PREFLIGHT_IDENTITY|database=' || current_database()
  || '|current_user=' || current_user || '|session_user=' || session_user
  || '|version=' || current_setting('server_version') || '|port=' || current_setting('port') AS identity;

DO $outbox_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_count bigint;
  v_expected record;
  v_actual record;
  v_type text;
  v_not_null boolean;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: database identity is not the isolated local PostgreSQL 17 validation database');
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: Supabase migration history is absent');
  ELSE
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='supabase_migrations'
         AND table_name='schema_migrations' AND column_name IN ('version','statements','name'))<>3
       OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='supabase_migrations'
         AND table_name='schema_migrations')<>3
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
      v_issues := pg_catalog.array_append(v_issues,'BLOCKED: migration history schema is not version/statements/name with version primary key');
    END IF;

    FOR v_expected IN SELECT * FROM (VALUES
      ('20261001000000',1::bigint),
      ('20261008000000',1::bigint),
      ('20261031170000',1::bigint),
      ('20261031180000',1::bigint),
      ('20261101090000',0::bigint)
    ) AS h(version,expected_count)
    LOOP
      SELECT count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version=v_expected.version;
      RAISE NOTICE 'OUTBOX_PREFLIGHT_HISTORY|version=%|actual=%|expected=%',v_expected.version,v_count,v_expected.expected_count;
      IF v_count<>v_expected.expected_count THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: migration history count mismatch for '||v_expected.version);
      END IF;
    END LOOP;
  END IF;

  IF pg_catalog.to_regclass('public.organizations') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.leads') IS NULL
     OR pg_catalog.to_regclass('public.follow_ups') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues,'BLOCKED: one or more follow-up authorization prerequisite tables are missing');
  ELSE
    FOR v_expected IN SELECT * FROM (VALUES
      ('organizations','id','uuid',true),
      ('organizations','owner_id','uuid',true),
      ('profiles','id','uuid',true),
      ('profiles','user_id','uuid',true),
      ('profiles','organization_id','uuid',false),
      ('profiles','role','character varying(50)',true),
      ('profiles','status','character varying(50)',false),
      ('profiles','email','character varying(255)',false),
      ('profiles','email_verified','boolean',true),
      ('leads','id','uuid',true),
      ('leads','organization_id','uuid',true),
      ('follow_ups','id','uuid',true),
      ('follow_ups','organization_id','uuid',true),
      ('follow_ups','lead_id','uuid',true),
      ('follow_ups','assigned_to','uuid',true),
      ('follow_ups','status','character varying(50)',false)
    ) AS c(table_name,column_name,expected_type,expected_not_null)
    LOOP
      SELECT pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull INTO v_type,v_not_null
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid=pg_catalog.to_regclass('public.'||v_expected.table_name)
         AND a.attname=v_expected.column_name AND a.attnum>0 AND NOT a.attisdropped;
      IF NOT FOUND OR v_type IS DISTINCT FROM v_expected.expected_type
         OR v_not_null IS DISTINCT FROM v_expected.expected_not_null THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: prerequisite column differs: public.'
          ||v_expected.table_name||'.'||v_expected.column_name);
      END IF;
    END LOOP;

    -- Exact parent relations, key columns, validation, and CASCADE behavior used
    -- by the outbox's organization/follow-up/recipient retention contract.
    FOR v_expected IN SELECT * FROM (VALUES
      ('follow_ups','follow_ups_organization_id_fkey','organizations',ARRAY['organization_id']::text[],ARRAY['id']::text[]),
      ('follow_ups','follow_ups_lead_id_fkey','leads',ARRAY['lead_id']::text[],ARRAY['id']::text[]),
      ('follow_ups','follow_ups_assigned_to_fkey','profiles',ARRAY['assigned_to']::text[],ARRAY['id']::text[]),
      ('leads','leads_organization_id_fkey','organizations',ARRAY['organization_id']::text[],ARRAY['id']::text[]),
      ('profiles','profiles_organization_id_fkey','organizations',ARRAY['organization_id']::text[],ARRAY['id']::text[])
    ) AS fk(child_table,constraint_name,parent_table,child_columns,parent_columns)
    LOOP
      SELECT c.contype,c.convalidated,c.confdeltype,c.confrelid,
        (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) AS child_columns,
        (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum) AS parent_columns
        INTO v_actual FROM pg_catalog.pg_constraint c
       WHERE c.conrelid=pg_catalog.to_regclass('public.'||v_expected.child_table)
         AND c.conname=v_expected.constraint_name;
      IF NOT FOUND OR v_actual.contype<>'f' OR NOT v_actual.convalidated OR v_actual.confdeltype<>'c'
         OR v_actual.confrelid IS DISTINCT FROM pg_catalog.to_regclass('public.'||v_expected.parent_table)
         OR v_actual.child_columns IS DISTINCT FROM v_expected.child_columns
         OR v_actual.parent_columns IS DISTINCT FROM v_expected.parent_columns THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: prerequisite relationship differs: '||v_expected.constraint_name);
      END IF;
    END LOOP;

    FOR v_expected IN SELECT unnest(ARRAY['organizations','profiles','leads','follow_ups']::text[]) AS table_name
    LOOP
      IF NOT (SELECT c.relrowsecurity AND c.relowner='postgres'::regrole::oid
                FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass('public.'||v_expected.table_name)) THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: tenant source table owner/RLS differs: public.'||v_expected.table_name);
      END IF;
      IF NOT pg_catalog.has_table_privilege('service_role','public.'||v_expected.table_name,'SELECT') THEN
        v_issues := pg_catalog.array_append(v_issues,'BLOCKED: server reminder processor lacks SELECT on public.'||v_expected.table_name);
      END IF;
    END LOOP;
  END IF;

  -- Migration has no backfill. A pre-existing target table, function overload,
  -- or index-name collision is ambiguous and must be inspected, never replayed.
  IF pg_catalog.to_regclass('public.follow_up_email_outbox') IS NOT NULL THEN
    v_issues := pg_catalog.array_append(v_issues,'REVIEW: public.follow_up_email_outbox already exists');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (
        'queue_follow_up_reminder_email','claim_follow_up_reminder_emails','complete_follow_up_reminder_email')) THEN
    v_issues := pg_catalog.array_append(v_issues,'REVIEW: one or more target outbox RPC names already exist');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('follow_up_email_outbox_pkey','follow_up_email_outbox_event_unique')) THEN
    v_issues := pg_catalog.array_append(v_issues,'REVIEW: target outbox index name already exists');
  END IF;

  IF pg_catalog.cardinality(v_issues)=0 THEN
    RAISE NOTICE 'OUTBOX_PREFLIGHT_STATUS|PASS|prerequisites=verified,target=absent,history=ready';
    RAISE NOTICE 'OUTBOX_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261101090000';
  ELSE
    RAISE NOTICE 'OUTBOX_PREFLIGHT_STATUS|BLOCKED|%',pg_catalog.array_to_string(v_issues,'; ');
    RAISE NOTICE 'OUTBOX_PREFLIGHT_SAFE_TO_APPLY|FAIL|review required';
  END IF;
END;
$outbox_preflight$;

ROLLBACK;
