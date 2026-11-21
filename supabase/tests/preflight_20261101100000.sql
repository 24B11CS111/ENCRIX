-- Read-only preflight for migration 20261101100000_unique_pending_invitations.
BEGIN TRANSACTION READ ONLY;

DO $invitation_preflight$
DECLARE
  v_history_version_count integer;
  v_duplicate_groups bigint;
  v_padded_pending_emails bigint;
  v_index_count integer;
  v_table oid;
  v_att record;
  v_prerequisite record;
  v_existing_index record;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port') <> '5432' THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|database identity mismatch';
    RETURN;
  END IF;
  RAISE NOTICE 'INVITATION_PREFLIGHT_IDENTITY|PASS|database=postgres|role=postgres|major=17|port=5432';

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|migration history table missing';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attname='version' AND atttypid='text'::regtype AND attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attname='statements' AND atttypid='text[]'::regtype AND NOT attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attname='name' AND atttypid='text'::regtype AND NOT attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='supabase_migrations.schema_migrations'::regclass AND contype='p' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attname='version')]::smallint[]) THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|migration history schema differs';
    RETURN;
  END IF;
  SELECT count(*) INTO v_history_version_count FROM supabase_migrations.schema_migrations WHERE version='20261101100000';
  IF v_history_version_count <> 0 THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|target migration history count=%', v_history_version_count;
    RETURN;
  END IF;
  FOR v_prerequisite IN
    SELECT expected.version, count(m.version) AS recorded_count
      FROM (VALUES ('20261031160000'),('20261031170000'),('20261031180000'),('20261101090000')) expected(version)
      LEFT JOIN supabase_migrations.schema_migrations m ON m.version=expected.version
     GROUP BY expected.version
  LOOP
    IF v_prerequisite.recorded_count <> 1 THEN
      RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|prerequisite % history count=%',v_prerequisite.version,v_prerequisite.recorded_count;
      RETURN;
    END IF;
  END LOOP;
  RAISE NOTICE 'INVITATION_PREFLIGHT_HISTORY|PASS|160000,170000,180000,190000 exactly once; 200000 absent';

  v_table := to_regclass('public.organization_invitations');
  IF v_table IS NULL OR (SELECT relkind FROM pg_class WHERE oid=v_table) <> 'r' THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|public.organization_invitations missing or not a table';
    RETURN;
  END IF;
  FOR v_att IN SELECT * FROM (VALUES
    ('id','uuid',true), ('organization_id','uuid',true), ('phone_number','character varying(50)',false),
    ('full_name','character varying(255)',true), ('email','character varying(255)',false),
    ('invited_by','uuid',true), ('role','character varying(50)',true), ('status','character varying(50)',true),
    ('token','character varying(100)',true), ('expires_at','timestamp with time zone',true),
    ('created_at','timestamp with time zone',true)
  ) AS expected(column_name,data_type,not_null)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid=v_table AND a.attname=v_att.column_name AND a.attnum>0 AND NOT a.attisdropped
         AND format_type(a.atttypid,a.atttypmod)=v_att.data_type
         AND a.attnotnull=v_att.not_null
    ) THEN
      RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|incompatible prerequisite column public.organization_invitations.%',v_att.column_name;
      RETURN;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_table AND c.conname='organization_invitations_pkey' AND c.contype='p' AND c.convalidated
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['id']::text[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_table AND c.conname='organization_invitations_token_key' AND c.contype='u' AND c.convalidated
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['token']::text[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_table AND c.conname='organization_invitations_organization_id_fkey' AND c.contype='f' AND c.convalidated AND c.confrelid='public.organizations'::regclass
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['organization_id']::text[]
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum)=ARRAY['id']::text[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_table AND c.conname='organization_invitations_invited_by_fkey' AND c.contype='f' AND c.convalidated AND c.confrelid='public.profiles'::regclass
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['invited_by']::text[]
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum)=ARRAY['id']::text[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_table AND c.conname='organization_invitations_role_check' AND c.contype='c' AND c.convalidated AND pg_get_constraintdef(c.oid) ILIKE '%TELECALLER%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_table AND c.conname='organization_invitations_status_check' AND c.contype='c' AND c.convalidated
          AND pg_get_constraintdef(c.oid) ILIKE '%PENDING%'
          AND pg_get_constraintdef(c.oid) ILIKE '%ACCEPTED%'
          AND pg_get_constraintdef(c.oid) ILIKE '%EXPIRED%'
          AND pg_get_constraintdef(c.oid) ILIKE '%REVOKED%')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=v_table AND conname='organization_invitations_pending_org_email_uidx') THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|invitation table dependencies or constraints differ';
    RETURN;
  END IF;
  RAISE NOTICE 'INVITATION_PREFLIGHT_TABLE|PASS|columns and relationship prerequisites verified';

  SELECT count(*) INTO v_duplicate_groups
    FROM (SELECT organization_id, lower(btrim(email))
            FROM public.organization_invitations
           WHERE status='PENDING' AND email IS NOT NULL
           GROUP BY organization_id, lower(btrim(email)) HAVING count(*) > 1) duplicates;
  IF v_duplicate_groups <> 0 THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|pending normalized-email duplicate groups=%',v_duplicate_groups;
    RETURN;
  END IF;
  SELECT count(*) INTO v_padded_pending_emails FROM public.organization_invitations
   WHERE status='PENDING' AND email IS NOT NULL AND email IS DISTINCT FROM btrim(email);
  IF v_padded_pending_emails <> 0 THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|pending invitations with surrounding email whitespace=%; review/normalize before apply',v_padded_pending_emails;
    RETURN;
  END IF;
  RAISE NOTICE 'INVITATION_PREFLIGHT_DATA|PASS|no pending organization/normalized-email duplicates';

  SELECT count(*) INTO v_index_count FROM pg_class c WHERE c.relname='organization_invitations_pending_org_email_uidx';
  IF v_index_count <> 0 THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|same-name index or relation already exists; review before apply';
    RETURN;
  END IF;
  FOR v_existing_index IN
    SELECT i.indexrelid, i.indkey, i.indnatts, i.indnkeyatts,
           pg_get_expr(i.indexprs,i.indrelid) AS expression,
           pg_get_expr(i.indpred,i.indrelid) AS predicate
      FROM pg_index i WHERE i.indrelid=v_table AND i.indisunique
  LOOP
    IF v_existing_index.indnatts=2 AND v_existing_index.indnkeyatts=2
       AND v_existing_index.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=v_table AND attname='organization_id')
       AND v_existing_index.indkey[1]=0
       AND regexp_replace(lower(v_existing_index.expression),'::character varying(\([0-9]+\))?|::text|[()"[:space:]]|pg_catalog\.','','g')='lowerbtrimemail' THEN
      RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|matching or overlapping unique organization/email index % already exists; reconcile separately',v_existing_index.indexrelid::regclass;
      RETURN;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug LIKE 'migration-200-org-%')
     OR EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 'migration-200-%@fixture.invalid')
     OR EXISTS (SELECT 1 FROM public.profiles WHERE full_name LIKE 'Migration 200 Test Owner %')
     OR EXISTS (SELECT 1 FROM public.organization_invitations WHERE token LIKE 'migration-200-%') THEN
    RAISE NOTICE 'INVITATION_PREFLIGHT_BLOCKED|reserved regression fixture identifiers already exist';
    RETURN;
  END IF;
  RAISE NOTICE 'INVITATION_PREFLIGHT_TARGET|PASS|target index absent and no conflicting equivalent index';
  RAISE NOTICE 'INVITATION_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261101100000';
END;
$invitation_preflight$;

ROLLBACK;
