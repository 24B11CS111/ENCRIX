-- READ-ONLY preflight for the eight migrations pending in the isolated
-- ENCRIX PostgreSQL 17 validation project. This script does not alter schema,
-- data, grants, publication membership, or migration history.
--
-- Execute only after independently verifying the isolated container and its
-- host-port mapping. Each block emits a MIGRATION|version|status|details NOTICE.
-- REVIEW means manual definition/compatibility inspection is required; BLOCKED
-- means a prerequisite, duplicate, or incompatible partial object was found.

BEGIN TRANSACTION READ ONLY;

DO $identity_guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 180000
     OR current_setting('port') <> '5432' THEN
    RAISE EXCEPTION 'IDENTITY_GUARD_FAILED: expected database postgres, role postgres, PostgreSQL 17, and container port 5432';
  END IF;
END;
$identity_guard$;

SELECT 'DATABASE_IDENTITY' AS check_name,
       current_database() AS database_name,
       current_user AS connected_role,
       current_setting('server_version') AS server_version,
       current_setting('port') AS server_port,
       inet_server_addr()::text AS server_address;

DO $lead_privilege_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_count bigint;
  v_130_history_count bigint := 0;
  v_has_direct_api_privilege boolean := false;
  v_role text;
  v_privilege text;
  v_column text;
BEGIN
  IF pg_catalog.to_regclass('public.leads') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: public.leads missing');
  ELSE
    SELECT pg_catalog.count(*) INTO v_count
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.leads'::pg_catalog.regclass
       AND attname IN ('organization_id','assigned_to','status','updated_at','priority','notes')
       AND attnum > 0 AND NOT attisdropped;
    IF v_count <> 6 THEN
      v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: one or more required leads columns missing');
    END IF;
  END IF;
  IF pg_catalog.to_regclass('public.lead_refresh_signals') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: prerequisite public.lead_refresh_signals missing');
  END IF;
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'
         AND column_name='version' AND data_type='text') THEN
    EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = $1'
      INTO v_130_history_count USING '20261031130000';
  END IF;
  IF pg_catalog.to_regprocedure('public.get_telecaller_student_detail(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.initiate_authorized_call(uuid)') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: reviewed lead/call RPC prerequisite missing');
  END IF;
  IF pg_catalog.to_regclass('public.leads') IS NOT NULL THEN
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF pg_catalog.has_table_privilege(v_role,'public.leads',v_privilege) THEN
          v_has_direct_api_privilege := true;
        END IF;
      END LOOP;
      FOR v_column IN SELECT a.attname FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='public.leads'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped LOOP
        FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
          IF pg_catalog.has_column_privilege(v_role,'public.leads',v_column,v_privilege) THEN
            v_has_direct_api_privilege := true;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
    IF NOT v_has_direct_api_privilege THEN
      IF v_130_history_count = 1 THEN
        RAISE NOTICE 'MIGRATION_HISTORY|20261031130000|count=1|status=RECORDED; direct API lead ACLs remain absent as expected';
      ELSE
        v_issues := pg_catalog.array_append(v_issues, 'REVIEW: anon/authenticated direct lead ACL is absent but migration 130000 is not recorded exactly once; reconcile after verifying effects');
      END IF;
    ELSE
      RAISE NOTICE 'LEADS_PRIVILEGE_EXPECTED_PRESTATE|anon/authenticated direct privileges exist and will be revoked';
    END IF;
  END IF;
  IF pg_catalog.to_regclass('public.leads') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='public.leads'::pg_catalog.regclass AND c.relrowsecurity) THEN
      v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: public.leads RLS is not enabled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid='public.leads'::pg_catalog.regclass AND p.polname='Admins and Owners manage org leads')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid='public.leads'::pg_catalog.regclass AND p.polname='Telecallers update only assigned leads') THEN
      v_issues := pg_catalog.array_append(v_issues, 'REVIEW: expected owner/admin and assigned-telecaller policies are absent');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_default_acl d
      CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
     WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
       AND d.defaclnamespace = '0'::oid
       AND d.defaclobjtype IN ('r','S','f')
       AND (x.grantee IN ('anon'::pg_catalog.regrole,
                          'authenticated'::pg_catalog.regrole,
                          'service_role'::pg_catalog.regrole)
         OR (d.defaclobjtype IN ('r','S') AND x.grantee = 0)
         OR (d.defaclobjtype = 'f' AND x.grantee = 0 AND x.privilege_type = 'EXECUTE'))
  ) THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: explicit global postgres default ACL conflicts with migration preflight');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
    WHERE d.defaclrole = 'postgres'::pg_catalog.regrole
      AND d.defaclnamespace = 'public'::pg_catalog.regnamespace
      AND d.defaclobjtype IN ('r','S','f')
      AND (x.grantee IN ('anon'::pg_catalog.regrole,
                         'authenticated'::pg_catalog.regrole,
                         'service_role'::pg_catalog.regrole)
        OR (d.defaclobjtype IN ('r','S') AND x.grantee = 0))
  ) THEN
    RAISE NOTICE 'PUBLIC_DEFAULT_ACL_EXPECTED_PRESTATE|public-schema postgres defaults include grants that this migration revokes';
  END IF;

  IF pg_catalog.cardinality(v_issues) = 0 THEN
    RAISE NOTICE 'MIGRATION|20261031130000|PASS|lead objects and global default-ACL preflight clear';
  ELSE
    RAISE NOTICE 'MIGRATION|20261031130000|%|%',
      CASE WHEN pg_catalog.array_to_string(v_issues, ' ') LIKE '%BLOCKED:%' THEN 'BLOCKED' ELSE 'REVIEW' END,
      pg_catalog.array_to_string(v_issues, '; ');
  END IF;
END;
$lead_privilege_preflight$;

DO $search_path_preflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_issues text[] := ARRAY[]::text[];
  v_owner name;
  v_config text[];
  v_definer boolean;
  v_role text;
  v_expected boolean;
BEGIN
  FOR v_signature IN SELECT unnest(ARRAY[
    'public.begin_caller_phone_enrollment(uuid,uuid,text,text)',
    'public.complete_caller_phone_enrollment(uuid,uuid,boolean)',
    'public.can_access_call_recording(uuid,uuid)',
    'public.can_access_call_recording(uuid)',
    'public.can_access_call_recording_path(text)',
    'public.get_telecaller_student_detail_legacy(uuid)',
    'public.is_caller_active()',
    'public.restrict_telecaller_lead_update_columns()'
  ]) LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    IF v_oid IS NULL THEN
      v_issues := pg_catalog.array_append(v_issues, ('BLOCKED: missing ' || v_signature));
      CONTINUE;
    END IF;
    SELECT pg_catalog.pg_get_userbyid(p.proowner)::name, p.prosecdef, p.proconfig
      INTO v_owner, v_definer, v_config FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_owner <> 'postgres' OR v_definer IS DISTINCT FROM TRUE THEN
      v_issues := pg_catalog.array_append(v_issues, ('BLOCKED: unexpected owner/SECURITY DEFINER for ' || v_signature));
    END IF;
    FOR v_role, v_expected IN
      SELECT e.role_name, e.expected_execute
        FROM (VALUES
          ('anon', false),
          ('authenticated', v_signature IN (
            'public.can_access_call_recording(uuid)',
            'public.can_access_call_recording_path(text)',
            'public.is_caller_active()')),
          ('service_role', v_signature <> 'public.get_telecaller_student_detail_legacy(uuid)')
        ) AS e(role_name, expected_execute)
    LOOP
      IF pg_catalog.has_function_privilege(v_role, v_oid, 'EXECUTE') IS DISTINCT FROM v_expected THEN
        v_issues := pg_catalog.array_append(v_issues, ('REVIEW: EXECUTE differs from reviewed matrix for ' || v_signature || ' / ' || v_role));
      END IF;
    END LOOP;
    IF v_config IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_config)) THEN
      v_issues := pg_catalog.array_append(v_issues, ('REVIEW: current path differs from expected pre-migration path for ' || v_signature));
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_issues) = 0 THEN
    RAISE NOTICE 'MIGRATION|20261031140000|PASS|all eight reviewed SECURITY DEFINER functions and pre-migration search paths verified';
  ELSE
    RAISE NOTICE 'MIGRATION|20261031140000|%|%',
      CASE WHEN pg_catalog.array_to_string(v_issues,' ') LIKE '%BLOCKED:%' THEN 'BLOCKED' ELSE 'REVIEW' END,
      pg_catalog.array_to_string(v_issues,'; ');
  END IF;
END;
$search_path_preflight$;

DO $otp_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_count bigint;
  v_history_ok boolean := true;
  v_table_ok boolean := true;
  v_index_ok boolean := true;
  v_index_absent boolean := true;
  v_rpc_ok boolean := true;
  v_rpc_absent boolean := true;
  v_target_columns_absent boolean := true;
  v_version text;
  v_version_count bigint;
  v_col record;
  v_actual_type text;
  v_actual_default text;
  v_actual_notnull boolean;
  v_table_relkind "char";
  v_purpose_definition text;
  v_purpose_check_count integer;
  v_id_default_function_count integer;
  v_id_default_uses_expected_function boolean;
  v_uuid_extension_ok boolean;
  v_ticket_attnum smallint;
  v_ticket_col_type oid;
  v_relkind "char";
  v_index_valid boolean;
  v_index_ready boolean;
  v_index_unique boolean;
  v_index_natts smallint;
  v_index_nkeyatts smallint;
  v_index_keys text;
  v_index_predicate text;
  v_index_method name;
  v_oid oid;
  v_expected record;
  v_proc record;
  v_direct_public boolean;
  v_direct_anon boolean;
  v_direct_authenticated boolean;
  v_direct_service boolean;
  v_direct_postgres boolean;
  v_unexpected_acl boolean;
  v_effective_anon boolean;
  v_effective_authenticated boolean;
  v_effective_service boolean;
  v_effective_postgres boolean;
  v_grantable_service boolean;
  v_stored_acl text;
  v_rpc_count integer := 0;
BEGIN
  -- Confirm the exact history schema and prerequisite ordering before calling
  -- the OTP migration pending. This block performs catalog reads only.
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_history_ok := false;
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: Supabase migration history table is missing');
  ELSE
    SELECT pg_catalog.count(*) INTO v_count
      FROM information_schema.columns
     WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'
       AND ((column_name='version' AND data_type='text' AND is_nullable='NO')
         OR (column_name='statements' AND data_type='ARRAY' AND udt_name='_text' AND is_nullable='YES')
         OR (column_name='name' AND data_type='text' AND is_nullable='YES'));
    IF v_count <> 3 OR (SELECT pg_catalog.count(*) FROM information_schema.columns
       WHERE table_schema='supabase_migrations' AND table_name='schema_migrations') <> 3
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_constraint c
          WHERE c.conrelid='supabase_migrations.schema_migrations'::pg_catalog.regclass
            AND c.contype='p'
            AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
              WHERE a.attrelid=c.conrelid AND a.attname='version' AND NOT a.attisdropped)]::smallint[]
       ) THEN
      v_history_ok := false;
      v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: unexpected migration history table columns or primary key');
    END IF;

    FOR v_version IN SELECT unnest(ARRAY[
      '20261008000000','20261031130000','20261031140000','20261031150000'
    ]) LOOP
      EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = $1'
        INTO v_version_count USING v_version;
      IF v_version IN ('20261008000000','20261031130000','20261031140000') THEN
        RAISE NOTICE 'MIGRATION_HISTORY|%|count=%|required=1',v_version,v_version_count;
        IF v_version_count <> 1 THEN
          v_history_ok := false;
          v_issues := pg_catalog.array_append(v_issues, ('BLOCKED: prerequisite migration history count is not exactly one: ' || v_version));
        END IF;
      ELSE
        RAISE NOTICE 'MIGRATION_HISTORY|%|count=%|required=0',v_version,v_version_count;
        IF v_version_count <> 0 THEN
          v_history_ok := false;
          v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: 20261031150000 already appears in migration history');
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF v_history_ok THEN
    RAISE NOTICE 'PREFLIGHT_MIGRATION_HISTORY|PASS|prerequisites=exactly-once target_20261031150000=ABSENT';
  ELSE
    RAISE NOTICE 'PREFLIGHT_MIGRATION_HISTORY|FAIL|prerequisite counts or target migration history state is unexpected';
  END IF;

  -- Base table contract from 20261008000000 and the two nullable columns added
  -- by 20261031150000. Existing target columns are accepted only in the exact
  -- migration-defined form; absent target columns are the expected pending state.
  SELECT c.relkind INTO v_table_relkind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='email_otps';
  IF pg_catalog.to_regclass('public.email_otps') IS NULL THEN
    v_table_ok := false;
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: public.email_otps missing');
  ELSIF v_table_relkind <> 'r' THEN
    v_table_ok := false;
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: public.email_otps name is occupied by a non-table relation');
  ELSE
    FOR v_col IN SELECT * FROM (VALUES
      ('id','uuid',true,'extensions.uuid_generate_v4()'),
      ('email','character varying(255)',true,NULL),
      ('purpose','character varying(50)',true,NULL),
      ('otp_hash','character varying(255)',true,NULL),
      ('attempts','integer',true,'0'),
      ('resend_after','timestamp with time zone',true,NULL),
      ('expires_at','timestamp with time zone',true,NULL),
      ('used','boolean',true,'false'),
      ('created_at','timestamp with time zone',true,'now()'),
      ('ticket_id','uuid',false,NULL),
      ('verified_at','timestamp with time zone',false,NULL)
    ) AS expected(column_name,type_name,required_not_null,expected_default)
    LOOP
      SELECT pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
             pg_catalog.pg_get_expr(d.adbin,d.adrelid)
        INTO v_actual_type,v_actual_notnull,v_actual_default
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE a.attrelid='public.email_otps'::pg_catalog.regclass
         AND a.attname=v_col.column_name AND a.attnum>0 AND NOT a.attisdropped;
      IF NOT FOUND THEN
        IF v_col.column_name NOT IN ('ticket_id','verified_at') THEN
          v_table_ok := false;
          v_issues := pg_catalog.array_append(v_issues, ('BLOCKED: required email_otps column missing: ' || v_col.column_name));
        END IF;
      ELSIF v_actual_type IS DISTINCT FROM v_col.type_name
         OR v_actual_notnull IS DISTINCT FROM v_col.required_not_null
         OR (v_col.column_name='id'
             AND NOT COALESCE(v_actual_default = ANY(ARRAY[
               'extensions.uuid_generate_v4()','uuid_generate_v4()'
             ]::text[]),false))
         OR (v_col.column_name<>'id'
             AND v_actual_default IS DISTINCT FROM v_col.expected_default) THEN
        v_table_ok := false;
        v_issues := pg_catalog.array_append(v_issues, ('BLOCKED: incompatible email_otps column definition: ' || v_col.column_name));
      END IF;
    END LOOP;

    -- Compare the parsed catalog dependency, not only pg_get_expr() spelling.
    -- Accept qualified and search_path-resolved unqualified text only when
    -- both resolve to this exact uuid-ossp member in schema extensions.
    SELECT pg_catalog.count(DISTINCT p.oid)::integer,
           COALESCE(pg_catalog.bool_and(p.oid=pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')::oid),false)
      INTO v_id_default_function_count,v_id_default_uses_expected_function
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_attrdef'::pg_catalog.regclass
        AND d.objid=ad.oid AND d.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass
      JOIN pg_catalog.pg_proc p ON p.oid=d.refobjid
     WHERE a.attrelid='public.email_otps'::pg_catalog.regclass
       AND a.attname='id' AND a.attnum>0 AND NOT a.attisdropped;
    SELECT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
        JOIN pg_catalog.pg_depend extension_member ON extension_member.classid='pg_catalog.pg_proc'::pg_catalog.regclass
          AND extension_member.objid=p.oid
          AND extension_member.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass
          AND extension_member.deptype='e'
        JOIN pg_catalog.pg_extension e ON e.oid=extension_member.refobjid
        JOIN pg_catalog.pg_namespace en ON en.oid=e.extnamespace
       WHERE p.oid=pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')::oid
         AND p.proname='uuid_generate_v4' AND pn.nspname='extensions'
         AND e.extname='uuid-ossp' AND en.nspname='extensions'
    ) INTO v_uuid_extension_ok;
    IF v_id_default_function_count<>1 OR NOT v_id_default_uses_expected_function OR NOT v_uuid_extension_ok THEN
      v_table_ok := false;
      v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: email_otps.id default does not resolve exclusively to extensions.uuid_generate_v4() from uuid-ossp in extensions');
      RAISE NOTICE 'OTP_PREFLIGHT|id_default_resolution|FAIL|function_dependency_count=% expected_function=% uuid_ossp_extension=%',
        v_id_default_function_count,v_id_default_uses_expected_function,v_uuid_extension_ok;
    ELSE
      RAISE NOTICE 'OTP_PREFLIGHT|id_default_resolution|PASS|qualified or unqualified catalog expression resolves to extensions.uuid_generate_v4() from uuid-ossp in extensions';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid='public.email_otps'::pg_catalog.regclass AND c.contype='p'
        AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
          WHERE a.attrelid=c.conrelid AND a.attname='id' AND NOT a.attisdropped)]::smallint[]) THEN
      v_table_ok := false;
      v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: email_otps primary key is not exactly the id column');
    END IF;
    SELECT pg_catalog.count(*)::integer,pg_catalog.min(pg_catalog.pg_get_constraintdef(c.oid))
      INTO v_purpose_check_count,v_purpose_definition
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid='public.email_otps'::pg_catalog.regclass AND c.contype='c'
       AND pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_constraintdef(c.oid)),'purpose')>0;
    IF v_purpose_check_count<>1
       OR pg_catalog.strpos(pg_catalog.lower(v_purpose_definition),'login')=0
       OR pg_catalog.strpos(pg_catalog.lower(v_purpose_definition),'register')=0
       OR pg_catalog.strpos(pg_catalog.lower(v_purpose_definition),'invitation')=0
       OR (pg_catalog.length(v_purpose_definition)-pg_catalog.length(pg_catalog.replace(v_purpose_definition,pg_catalog.chr(39),'')))<>6
       OR pg_catalog.lower(v_purpose_definition) ~ '\m(and|or|not)\M'
       OR (pg_catalog.strpos(pg_catalog.lower(v_purpose_definition),'any')=0
           AND pg_catalog.strpos(pg_catalog.lower(v_purpose_definition),' in ')=0) THEN
      v_table_ok := false;
      v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: email_otps purpose check does not permit exactly the migration purpose set');
    END IF;

    SELECT a.attnum,a.atttypid INTO v_ticket_attnum,v_ticket_col_type
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid='public.email_otps'::pg_catalog.regclass AND a.attname='ticket_id'
       AND a.attnum>0 AND NOT a.attisdropped;
    IF v_ticket_col_type IS NOT NULL AND v_ticket_col_type='pg_catalog.uuid'::pg_catalog.regtype THEN
      SELECT pg_catalog.count(*) INTO v_count FROM (
        SELECT ticket_id FROM public.email_otps WHERE ticket_id IS NOT NULL
         GROUP BY ticket_id HAVING pg_catalog.count(*)>1
      ) duplicates;
      IF v_count>0 THEN
        v_table_ok := false;
        v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: duplicate non-null email_otps.ticket_id values');
      END IF;
    END IF;
    SELECT pg_catalog.count(*) INTO v_count
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid='public.email_otps'::pg_catalog.regclass
       AND a.attname IN ('ticket_id','verified_at') AND a.attnum>0 AND NOT a.attisdropped;
    IF v_count>0 THEN
      v_target_columns_absent := false;
      RAISE NOTICE 'OTP_PREFLIGHT|target_columns|REVIEW|one or both target columns already exist with compatible definitions';
    ELSE
      RAISE NOTICE 'OTP_PREFLIGHT|target_columns|PASS|both target columns absent as expected';
    END IF;
  END IF;
  IF v_table_ok THEN
    RAISE NOTICE 'OTP_PREFLIGHT|table_and_data|PASS|base column contract, target column compatibility, constraints, and ticket duplicate check passed';
  ELSE
    RAISE NOTICE 'OTP_PREFLIGHT|table_and_data|FAIL|email_otps schema or data conflicts with migration';
  END IF;

  -- Exact target index contract: unique btree on ticket_id with the sole
  -- partial predicate ticket_id IS NOT NULL. A same-name non-index is conflict.
  SELECT c.relkind INTO v_relkind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='email_otps_ticket_id_uidx';
  IF v_relkind IS NOT NULL THEN
    v_index_absent := false;
    IF v_relkind <> 'i' THEN
      v_index_ok := false;
    ELSE
      SELECT i.indisunique,i.indisvalid,i.indisready,i.indnatts,i.indnkeyatts,
             i.indkey::text,
             pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred,i.indrelid)),'[()"[:space:]]','','g'),
             am.amname
        INTO v_index_unique,v_index_valid,v_index_ready,v_index_natts,v_index_nkeyatts,v_index_keys,v_index_predicate,v_index_method
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_catalog.pg_am am ON am.oid=c.relam
       WHERE n.nspname='public' AND c.relname='email_otps_ticket_id_uidx'
         AND i.indrelid='public.email_otps'::pg_catalog.regclass;
      -- `indisready` is separately required so an invalid/incomplete index is
      -- never treated as an already-satisfied migration effect.
      IF v_index_unique IS DISTINCT FROM true OR v_index_valid IS DISTINCT FROM true OR v_index_ready IS DISTINCT FROM true
         OR v_index_natts<>1 OR v_index_nkeyatts<>1
         OR v_index_keys IS DISTINCT FROM v_ticket_attnum::text
         OR v_index_predicate IS DISTINCT FROM 'ticket_idisnotnull'
         OR v_index_method IS DISTINCT FROM 'btree' THEN
        v_index_ok := false;
      END IF;
    END IF;
    IF v_index_ok THEN
      RAISE NOTICE 'OTP_PREFLIGHT|target_index|REVIEW|same-name target index already exists and exactly matches migration';
    ELSE
      v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: conflicting or invalid email_otps_ticket_id_uidx object');
      RAISE NOTICE 'OTP_PREFLIGHT|target_index|FAIL|same-name object is not the exact valid unique partial index';
    END IF;
  ELSE
    RAISE NOTICE 'OTP_PREFLIGHT|target_index|PASS|target index absent as expected';
  END IF;

  -- Expected prosrc hashes are pinned to the migration source and covered by
  -- the static Vitest contract test. This permits exact body comparison without
  -- relying on formatting of pg_get_functiondef().
  FOR v_expected IN SELECT * FROM (VALUES
    ('public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)',
     ARRAY['p_ticket_id','p_email','p_purpose','p_otp_hash','p_resend_after','p_expires_at']::text[],
     'jsonb','4cf0df1329fa0ab39f0b14a3781bc956'),
    ('public.complete_email_otp_verification(uuid,text,text,boolean)',
     ARRAY['p_ticket_id','p_email','p_purpose','p_is_valid']::text[],
     'jsonb','c3eb7b2579bd07b1274f370b4391b3e2'),
    ('public.cancel_email_otp_ticket(uuid,text,text)',
     ARRAY['p_ticket_id','p_email','p_purpose']::text[],
     'boolean','5bf04cce3a75594874c64c63383ad2dd')
  ) AS functions(signature,arg_names,result_type,body_md5)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature)::oid;
    IF v_oid IS NULL THEN
      RAISE NOTICE 'OTP_RPC|%|PENDING|function absent',v_expected.signature;
      CONTINUE;
    END IF;
    v_rpc_absent := false;
    v_rpc_count := v_rpc_count+1;
    SELECT p.*,pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_name,
           l.lanname,pg_catalog.format_type(p.prorettype,NULL) AS result_name
      INTO v_proc
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
     WHERE p.oid=v_oid;
    IF v_proc.owner_name IS DISTINCT FROM 'postgres'
       OR v_proc.prosecdef IS DISTINCT FROM true
       OR v_proc.provolatile IS DISTINCT FROM 'v'
       OR v_proc.proisstrict IS DISTINCT FROM false
       OR v_proc.proparallel IS DISTINCT FROM 'u'
       OR v_proc.lanname IS DISTINCT FROM 'plpgsql'
       OR v_proc.result_name IS DISTINCT FROM v_expected.result_type
       OR v_proc.proargnames IS DISTINCT FROM v_expected.arg_names
       OR v_proc.proargmodes IS NOT NULL
       OR v_proc.proallargtypes IS NOT NULL
       OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
       OR pg_catalog.md5(v_proc.prosrc) IS DISTINCT FROM v_expected.body_md5 THEN
      v_rpc_ok := false;
      v_issues := pg_catalog.array_append(v_issues, ('BLOCKED: incompatible OTP RPC definition or metadata: ' || v_expected.signature));
    END IF;

    SELECT
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a WHERE a.grantee='anon'::pg_catalog.regrole AND a.privilege_type='EXECUTE'),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a WHERE a.grantee='authenticated'::pg_catalog.regrole AND a.privilege_type='EXECUTE'),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a WHERE a.grantee='service_role'::pg_catalog.regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a WHERE a.grantee=v_proc.proowner AND a.privilege_type='EXECUTE'),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a WHERE a.grantee NOT IN (0::oid,'anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole,'service_role'::pg_catalog.regrole,v_proc.proowner) AND a.privilege_type='EXECUTE'),
      pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE'),
      pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE'),
      pg_catalog.has_function_privilege('postgres',v_oid,'EXECUTE'),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a WHERE a.grantee='service_role'::pg_catalog.regrole AND a.privilege_type='EXECUTE' AND a.is_grantable)
    INTO v_direct_public,v_direct_anon,v_direct_authenticated,v_direct_service,v_direct_postgres,v_unexpected_acl,
         v_effective_anon,v_effective_authenticated,v_effective_service,v_effective_postgres,v_grantable_service;
    v_stored_acl := COALESCE(v_proc.proacl::text,'<default ACL>');
    IF v_direct_public OR v_direct_anon OR v_direct_authenticated
       OR NOT v_direct_service OR NOT v_direct_postgres OR v_unexpected_acl OR v_grantable_service
       OR v_effective_anon OR v_effective_authenticated
       OR NOT v_effective_service OR NOT v_effective_postgres THEN
      v_rpc_ok := false;
      v_issues := pg_catalog.array_append(v_issues, ('BLOCKED: stored or effective OTP RPC EXECUTE ACL mismatch: ' || v_expected.signature));
    END IF;
    RAISE NOTICE 'OTP_RPC|%|%|owner=%|definer=%|language=%|volatility=%|strict=%|parallel=%|search_path=%|stored_acl=%|effective anon/auth/service/postgres=%/%/%/%',
      v_expected.signature,CASE WHEN v_rpc_ok THEN 'COMPATIBLE' ELSE 'CONFLICT' END,
      v_proc.owner_name,v_proc.prosecdef,v_proc.lanname,v_proc.provolatile,v_proc.proisstrict,v_proc.proparallel,v_proc.proconfig,
      v_stored_acl,v_effective_anon,v_effective_authenticated,v_effective_service,v_effective_postgres;
  END LOOP;
  IF v_rpc_count=0 THEN
    RAISE NOTICE 'OTP_PREFLIGHT|rpc_definitions_and_acl|PASS|all target RPCs absent as expected';
  ELSIF v_rpc_count=3 AND v_rpc_ok THEN
    RAISE NOTICE 'OTP_PREFLIGHT|rpc_definitions_and_acl|REVIEW|all target RPCs already exist and match exact migration body, metadata, and ACL contract';
  ELSE
    v_rpc_ok := false;
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: partial or incompatible target OTP RPC set');
    RAISE NOTICE 'OTP_PREFLIGHT|rpc_definitions_and_acl|FAIL|partial or incompatible target RPC set';
  END IF;

  IF pg_catalog.cardinality(v_issues)>0 THEN
    RAISE NOTICE 'MIGRATION|20261031150000|FAIL|%',pg_catalog.array_to_string(v_issues,'; ');
  ELSIF v_index_absent AND v_rpc_absent AND v_target_columns_absent THEN
    RAISE NOTICE 'MIGRATION|20261031150000|PASS|prerequisites valid and migration target effects are absent';
  ELSE
    RAISE NOTICE 'MIGRATION|20261031150000|REVIEW|one or more compatible target effects already exist; reconcile before migration application';
  END IF;
  IF v_history_ok AND v_table_ok AND v_index_ok AND v_index_absent
     AND v_rpc_ok AND v_rpc_absent AND v_target_columns_absent
     AND pg_catalog.cardinality(v_issues)=0 THEN
    RAISE NOTICE 'PREFLIGHT_SAFE_TO_APPLY|PASS|history prerequisites recorded exactly-once target_20261031150000=ABSENT; OTP prerequisites valid and migration target objects absent';
  ELSE
    RAISE NOTICE 'PREFLIGHT_BLOCKED|FAIL|history, prerequisite, compatible-existing-object, or conflict checks require review before migration application';
  END IF;
END;
$otp_preflight$;

DO $twilio_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_count bigint;
  v_target_count integer := 0;
  v_state_count bigint;
  v_flow_count bigint;
BEGIN
  IF pg_catalog.to_regclass('public.organizations') IS NULL OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.leads') IS NULL OR pg_catalog.to_regclass('public.calls') IS NULL
     OR pg_catalog.to_regclass('public.call_bridges') IS NULL OR pg_catalog.to_regclass('public.activity_logs') IS NULL
     OR pg_catalog.to_regprocedure('extensions.uuid_generate_v4()') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: Twilio migration prerequisite relation or UUID extension function missing');
  END IF;
  IF pg_catalog.to_regclass('public.organization_twilio_credentials') IS NOT NULL THEN v_target_count := v_target_count + 1; END IF;
  IF pg_catalog.to_regclass('public.telephony_inbound_attempts') IS NOT NULL THEN v_target_count := v_target_count + 1; END IF;
  IF pg_catalog.to_regprocedure('public.prepare_twilio_outbound_call(uuid,uuid,uuid,uuid,timestamp with time zone)') IS NOT NULL THEN v_target_count := v_target_count + 1; END IF;
  IF v_target_count > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'REVIEW: partial/already-present Twilio target objects detected; do not replay blindly'); END IF;
  IF pg_catalog.to_regclass('public.call_bridges') IS NOT NULL AND pg_catalog.to_regclass('public.calls') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM public.call_bridges WHERE customer_leg_state NOT IN
      ('PENDING','CREATING','QUEUED','RINGING','IN_PROGRESS','COMPLETED','BUSY','NO_ANSWER','CANCELED','FAILED','RECOVERY_REQUIRED')$q$
      INTO v_state_count;
    IF v_state_count > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: call_bridges rows violate proposed customer_leg_state check'); END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.call_bridges'::pg_catalog.regclass AND attname='flow' AND NOT attisdropped) THEN
      EXECUTE $q$SELECT count(*) FROM public.call_bridges WHERE flow NOT IN ('OUTBOUND','INBOUND')$q$ INTO v_flow_count;
      IF v_flow_count > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: existing call_bridges.flow values violate proposed check'); END IF;
    END IF;
    EXECUTE $q$SELECT count(*) FROM (
      SELECT provider_call_id FROM public.calls WHERE provider='TWILIO' AND provider_call_id IS NOT NULL
      GROUP BY provider_call_id HAVING count(*)>1) d$q$ INTO v_count;
    IF v_count > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: duplicate Twilio provider_call_id values'); END IF;
    IF pg_catalog.to_regclass('public.organization_twilio_credentials') IS NOT NULL THEN
      SELECT pg_catalog.count(*) INTO v_count FROM pg_catalog.pg_attribute
       WHERE attrelid='public.organization_twilio_credentials'::pg_catalog.regclass
         AND attname IN ('twilio_phone_number','status') AND attnum > 0 AND NOT attisdropped;
      IF v_count <> 2 THEN
        v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: partial organization_twilio_credentials table lacks required columns');
      ELSE
        EXECUTE $q$SELECT count(*) FROM (
          SELECT twilio_phone_number FROM public.organization_twilio_credentials WHERE status='ACTIVE'
          GROUP BY twilio_phone_number HAVING count(*)>1) d$q$ INTO v_count;
        IF v_count > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: duplicate active Twilio phone numbers'); END IF;
      END IF;
    END IF;
  END IF;
  IF pg_catalog.to_regclass('public.organization_twilio_credentials') IS NULL
     AND pg_catalog.to_regclass('public.telephony_inbound_attempts') IS NULL
     AND pg_catalog.to_regclass('public.call_bridges') IS NOT NULL THEN
    -- A flow column or target indexes/functions without the new tables also
    -- indicates a partial prior attempt.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.call_bridges'::pg_catalog.regclass AND attname='flow' AND NOT attisdropped)
       OR pg_catalog.to_regclass('public.leads_org_phone_inbound_idx') IS NOT NULL
       OR pg_catalog.to_regclass('public.calls_twilio_provider_call_id_uidx') IS NOT NULL THEN
      v_issues := pg_catalog.array_append(v_issues, 'REVIEW: Twilio migration artifacts exist although target tables are absent');
    END IF;
  END IF;
  IF pg_catalog.cardinality(v_issues)=0 THEN
    RAISE NOTICE 'MIGRATION|20261031160000|PASS|dependencies, state values, duplicate SIDs, and active-number conflicts clear';
  ELSE
    RAISE NOTICE 'MIGRATION|20261031160000|%|%',
      CASE WHEN pg_catalog.array_to_string(v_issues,' ') LIKE '%BLOCKED:%' THEN 'BLOCKED' ELSE 'REVIEW' END,
      pg_catalog.array_to_string(v_issues,'; ');
  END IF;
END;
$twilio_preflight$;

DO $razorpay_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_bad bigint;
  v_definition text;
  v_valid boolean;
BEGIN
  IF pg_catalog.to_regclass('public.billing_payments') IS NULL OR pg_catalog.to_regclass('public.organization_subscriptions') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: billing foundation tables missing');
  ELSE
    SELECT pg_catalog.count(*) INTO v_bad FROM pg_catalog.pg_attribute
     WHERE attrelid='public.billing_payments'::pg_catalog.regclass
       AND attname IN ('organization_id','subscription_id','provider','idempotency_key','razorpay_payment_id',
                       'razorpay_invoice_id','amount_paise','currency','status','signature_verified_at','paid_at')
       AND attnum>0 AND NOT attisdropped;
    IF v_bad <> 11 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: billing_payments lacks required lifecycle columns'); END IF;
    SELECT pg_catalog.count(*) INTO v_bad FROM pg_catalog.pg_attribute
     WHERE attrelid='public.organization_subscriptions'::pg_catalog.regclass
       AND attname IN ('organization_id','plan_code','amount_paise','razorpay_plan_id','razorpay_subscription_id',
                       'entitlement_source','status','is_current','current_period_start','current_period_end')
       AND attnum>0 AND NOT attisdropped;
    IF v_bad <> 10 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: organization_subscriptions lacks required lifecycle columns'); END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.billing_payments'::pg_catalog.regclass AND attname='amount_refunded_paise' AND atttypid <> 'pg_catalog.int8'::pg_catalog.regtype AND NOT attisdropped)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.organization_subscriptions'::pg_catalog.regclass AND attname='razorpay_total_count' AND atttypid <> 'pg_catalog.int4'::pg_catalog.regtype AND NOT attisdropped) THEN
      v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: existing Razorpay lifecycle columns have incompatible types');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.billing_payments'::pg_catalog.regclass AND attname='amount_refunded_paise' AND NOT attisdropped) THEN
      EXECUTE $q$SELECT count(*) FROM public.billing_payments
        WHERE amount_refunded_paise < 0 OR amount_refunded_paise > amount_paise
           OR (amount_refunded_paise > 0 AND status NOT IN ('captured','refunded'))$q$ INTO v_bad;
      IF v_bad > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: billing payment rows violate proposed refund checks'); END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.organization_subscriptions'::pg_catalog.regclass AND attname='razorpay_total_count' AND NOT attisdropped) THEN
      EXECUTE $q$SELECT count(*) FROM public.organization_subscriptions WHERE razorpay_total_count IS NOT NULL AND razorpay_total_count <= 0$q$ INTO v_bad;
      IF v_bad > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: subscription total_count rows violate proposed positive check'); END IF;
    END IF;
    SELECT pg_catalog.pg_get_constraintdef(c.oid), c.convalidated INTO v_definition,v_valid
      FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.billing_payments'::pg_catalog.regclass AND c.conname='billing_payments_refund_amount_valid';
    IF v_definition IS NOT NULL THEN
      RAISE NOTICE 'RAZORPAY_EXISTING_CONSTRAINT|billing_payments_refund_amount_valid|validated=%|definition=%',v_valid,v_definition;
      IF NOT v_valid OR pg_catalog.replace(pg_catalog.lower(v_definition),' ','') NOT LIKE '%amount_refunded_paise>=0%amount_refunded_paise<=amount_paise%' THEN
        v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: same-name refund amount constraint is incompatible or unvalidated');
      END IF;
    END IF;
    SELECT pg_catalog.pg_get_constraintdef(c.oid),c.convalidated INTO v_definition,v_valid
      FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.billing_payments'::pg_catalog.regclass AND c.conname='billing_payments_refund_status_valid';
    IF v_definition IS NOT NULL THEN
      RAISE NOTICE 'RAZORPAY_EXISTING_CONSTRAINT|billing_payments_refund_status_valid|validated=%|definition=%',v_valid,v_definition;
      IF NOT v_valid
         OR pg_catalog.lower(pg_catalog.regexp_replace(v_definition,'\s+','','g')) NOT LIKE '%amount_refunded_paise=0%'
         OR pg_catalog.lower(pg_catalog.regexp_replace(v_definition,'\s+','','g')) NOT LIKE '%status=any(array[''captured''::text,''refunded''::text])%' THEN
        v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: same-name refund status constraint is incompatible or unvalidated');
      END IF;
    END IF;
    SELECT pg_catalog.pg_get_constraintdef(c.oid),c.convalidated INTO v_definition,v_valid
      FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.organization_subscriptions'::pg_catalog.regclass AND c.conname='organization_subscriptions_total_count_positive';
    IF v_definition IS NOT NULL THEN
      RAISE NOTICE 'RAZORPAY_EXISTING_CONSTRAINT|organization_subscriptions_total_count_positive|validated=%|definition=%',v_valid,v_definition;
      IF NOT v_valid
         OR pg_catalog.lower(pg_catalog.regexp_replace(v_definition,'\s+','','g')) NOT LIKE '%razorpay_total_countisnull%'
         OR pg_catalog.lower(pg_catalog.regexp_replace(v_definition,'\s+','','g')) NOT LIKE '%razorpay_total_count>0%' THEN
        v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: same-name total-count constraint is incompatible or unvalidated');
      END IF;
    END IF;
  END IF;
  IF pg_catalog.to_regprocedure('public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)') IS NOT NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'REVIEW: target Razorpay RPC already exists; compare exact definition/ACL before replay');
  END IF;
  IF pg_catalog.to_regclass('public.billing_payments_verified_subscription_period') IS NOT NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'REVIEW: target Razorpay index name already exists; verify its exact definition');
  END IF;
  IF pg_catalog.to_regclass('public.billing_payments') IS NOT NULL
     AND pg_catalog.to_regclass('public.organization_subscriptions') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.billing_payments'::pg_catalog.regclass AND attname='amount_refunded_paise' AND NOT attisdropped)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.organization_subscriptions'::pg_catalog.regclass AND attname='razorpay_total_count' AND NOT attisdropped)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname IN (
         'billing_payments_refund_amount_valid','billing_payments_refund_status_valid',
         'organization_subscriptions_total_count_positive')) THEN
      v_issues := pg_catalog.array_append(v_issues, 'REVIEW: some Razorpay migration target columns/constraints already exist; compare each definition before replay');
    END IF;
  END IF;
  IF pg_catalog.to_regclass('public.billing_payments') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.billing_payments'::pg_catalog.regclass AND attname='razorpay_payment_id' AND NOT attisdropped) THEN
    EXECUTE $q$SELECT count(*) FROM (
      SELECT razorpay_payment_id FROM public.billing_payments
       WHERE razorpay_payment_id IS NOT NULL GROUP BY razorpay_payment_id HAVING count(*)>1) d$q$ INTO v_bad;
    IF v_bad > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: duplicate Razorpay payment IDs'); END IF;
  END IF;
  IF pg_catalog.cardinality(v_issues)=0 THEN
    RAISE NOTICE 'MIGRATION|20261031170000|PASS|billing tables and refund/period preconditions clear';
  ELSE
    RAISE NOTICE 'MIGRATION|20261031170000|%|%',
      CASE WHEN pg_catalog.array_to_string(v_issues,' ') LIKE '%BLOCKED:%' THEN 'BLOCKED' ELSE 'REVIEW' END,
      pg_catalog.array_to_string(v_issues,'; ');
  END IF;
END;
$razorpay_preflight$;

DO $entitlement_preflight$
BEGIN
  IF pg_catalog.to_regclass('public.organization_subscriptions') IS NULL OR pg_catalog.to_regclass('public.billing_payments') IS NULL THEN
    RAISE NOTICE 'MIGRATION|20261031180000|BLOCKED|billing prerequisites missing';
  ELSIF pg_catalog.to_regprocedure('public.organization_has_active_paid_entitlement(uuid)') IS NOT NULL THEN
    RAISE NOTICE 'MIGRATION|20261031180000|REVIEW|target function already exists; compare exact body, owner, search_path, and EXECUTE ACL';
  ELSE
    RAISE NOTICE 'MIGRATION|20261031180000|PASS|billing prerequisites exist and target function is absent';
  END IF;
END;
$entitlement_preflight$;

DO $outbox_preflight$
DECLARE
  v_issues text[] := ARRAY[]::text[];
  v_target_count integer := 0;
  v_definition text;
  v_count bigint;
  v_oid oid;
BEGIN
  IF pg_catalog.to_regclass('public.organizations') IS NULL OR pg_catalog.to_regclass('public.follow_ups') IS NULL
     OR pg_catalog.to_regclass('public.leads') IS NULL OR pg_catalog.to_regclass('public.profiles') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: outbox prerequisite table missing');
  END IF;
  IF pg_catalog.to_regclass('public.follow_up_email_outbox') IS NOT NULL THEN v_target_count := v_target_count + 1; END IF;
  IF pg_catalog.to_regprocedure('public.queue_follow_up_reminder_email(uuid,uuid,uuid,text,text,text,text,text)') IS NOT NULL THEN v_target_count := v_target_count + 1; END IF;
  IF pg_catalog.to_regprocedure('public.claim_follow_up_reminder_emails(uuid,integer)') IS NOT NULL THEN v_target_count := v_target_count + 1; END IF;
  IF pg_catalog.to_regprocedure('public.complete_follow_up_reminder_email(uuid,uuid,boolean,text,text)') IS NOT NULL THEN v_target_count := v_target_count + 1; END IF;
  IF v_target_count > 0 THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: outbox migration fail-closed preflight will reject existing/partial target objects');
    IF pg_catalog.to_regclass('public.follow_up_email_outbox') IS NOT NULL THEN
      RAISE NOTICE 'OUTBOX_EXISTING_TABLE|columns=%|RLS=%|FKs=%|constraints=%',
        (SELECT pg_catalog.string_agg(a.attname,',' ORDER BY a.attnum)
           FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.follow_up_email_outbox'::pg_catalog.regclass
             AND a.attnum>0 AND NOT a.attisdropped),
        (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid='public.follow_up_email_outbox'::pg_catalog.regclass),
        (SELECT pg_catalog.string_agg(pg_catalog.pg_get_constraintdef(c.oid),'; ')
           FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.follow_up_email_outbox'::pg_catalog.regclass AND c.contype='f'),
        (SELECT pg_catalog.string_agg(pg_catalog.pg_get_constraintdef(c.oid),'; ')
           FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.follow_up_email_outbox'::pg_catalog.regclass);
      RAISE NOTICE 'OUTBOX_EXISTING_PRIVILEGES|anon_select=%|authenticated_select=%|service_role_select=%|RLS=%',
        pg_catalog.has_table_privilege('anon','public.follow_up_email_outbox','SELECT'),
        pg_catalog.has_table_privilege('authenticated','public.follow_up_email_outbox','SELECT'),
        pg_catalog.has_table_privilege('service_role','public.follow_up_email_outbox','SELECT'),
        (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid='public.follow_up_email_outbox'::pg_catalog.regclass);
    END IF;
    FOR v_definition IN
      SELECT pg_catalog.pg_get_functiondef(p.oid)
        FROM pg_catalog.pg_proc p
       WHERE p.oid IN (
         pg_catalog.to_regprocedure('public.queue_follow_up_reminder_email(uuid,uuid,uuid,text,text,text,text,text)')::oid,
         pg_catalog.to_regprocedure('public.claim_follow_up_reminder_emails(uuid,integer)')::oid,
         pg_catalog.to_regprocedure('public.complete_follow_up_reminder_email(uuid,uuid,boolean,text,text)')::oid
       )
    LOOP
      RAISE NOTICE 'OUTBOX_EXISTING_RPC_DEFINITION|%', v_definition;
    END LOOP;

  END IF;
  IF pg_catalog.to_regclass('public.organization_invitations') IS NULL THEN
    v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: invitation prerequisite table missing');
  ELSE
    EXECUTE $q$SELECT count(*) FROM (
      SELECT organization_id, pg_catalog.lower(pg_catalog.btrim(email))
        FROM public.organization_invitations
       WHERE status='PENDING' AND email IS NOT NULL
       GROUP BY organization_id, pg_catalog.lower(pg_catalog.btrim(email)) HAVING count(*)>1) d$q$ INTO v_count;
    IF v_count > 0 THEN v_issues := pg_catalog.array_append(v_issues, 'BLOCKED: duplicate pending invitation organization/normalized-email groups'); END IF;
  END IF;
  IF pg_catalog.cardinality(v_issues)=0 THEN
    RAISE NOTICE 'MIGRATION|20261101090000|PASS|dependencies exist, outbox target objects absent, authorization relationships ready for post-migration tests';
  ELSE
    RAISE NOTICE 'MIGRATION|20261101090000|%|%',
      CASE WHEN pg_catalog.array_to_string(v_issues,' ') LIKE '%BLOCKED:%' THEN 'BLOCKED' ELSE 'REVIEW' END,
      pg_catalog.array_to_string(v_issues,'; ');
  END IF;
END;
$outbox_preflight$;

DO $invitation_unique_preflight$
DECLARE
  v_count bigint;
  v_definition text;
BEGIN
  IF pg_catalog.to_regclass('public.organization_invitations') IS NULL THEN
    RAISE NOTICE 'MIGRATION|20261101100000|BLOCKED|public.organization_invitations missing';
    RETURN;
  END IF;
  EXECUTE $q$SELECT count(*) FROM (
    SELECT organization_id, pg_catalog.lower(pg_catalog.btrim(email))
      FROM public.organization_invitations
     WHERE status='PENDING' AND email IS NOT NULL
     GROUP BY organization_id, pg_catalog.lower(pg_catalog.btrim(email)) HAVING count(*)>1) d$q$ INTO v_count;
  IF v_count > 0 THEN
    RAISE NOTICE 'MIGRATION|20261101100000|BLOCKED|duplicate pending invitation groups: %',v_count;
    RETURN;
  END IF;
  SELECT pg_catalog.pg_get_indexdef(c.oid) INTO v_definition
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='organization_invitations_pending_org_email_uidx';
  IF v_definition IS NOT NULL THEN
    IF v_definition NOT ILIKE '%UNIQUE INDEX%'
       OR v_definition NOT ILIKE '%(organization_id, lower(btrim(email)))%'
       OR v_definition NOT ILIKE '%status = ''PENDING''%'
       OR v_definition NOT ILIKE '%email IS NOT NULL%' THEN
      RAISE NOTICE 'MIGRATION|20261101100000|BLOCKED|same-name index has incompatible definition: %',v_definition;
      RETURN;
    END IF;
    RAISE NOTICE 'MIGRATION|20261101100000|REVIEW|index already exists with apparently matching definition; verify exact pg_get_indexdef before migration runner';
  ELSE
    RAISE NOTICE 'MIGRATION|20261101100000|PASS|no duplicate groups and target index absent';
  END IF;
END;
$invitation_unique_preflight$;

COMMIT;
