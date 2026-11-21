-- HISTORY-ONLY reconciliation for 20261031130000.
-- This script does not execute migration SQL or modify ACLs, functions, defaults,
-- policies, application tables, or customer data. It inserts one history row
-- only after the supplied database identity and migration-state guards pass.
-- Verify the container ID and migration checksum in the PowerShell wrapper.

BEGIN;

DO $reconcile$
DECLARE
  v_history_oid oid;
  v_column_count integer;
  v_version_attnum smallint;
  v_constraint_count integer;
  v_primary_key_count integer;
  v_history_count integer;
  v_inserted integer;
  v_signature regprocedure;
  v_function record;
  v_function_oid oid;
  v_owner oid;
  v_is_security_definer boolean;
  v_proconfig text[];
  v_prosrc text;
  v_return_type oid;
  v_language name;
  v_argument_names text[];
  v_volatility "char";
  v_strict boolean;
  v_parallel "char";
  v_expected_detail_body text := $expected_body$
DECLARE
  caller_profile public.profiles%ROWTYPE;
  target_organization_id UUID;
BEGIN
  SELECT p.*
    INTO caller_profile
    FROM public.profiles AS p
   WHERE p.user_id = auth.uid()
   LIMIT 1;

  IF caller_profile.id IS NULL OR caller_profile.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Access Denied: Unauthenticated or inactive profile.';
  END IF;

  SELECT l.organization_id
    INTO target_organization_id
    FROM public.leads AS l
   WHERE l.id = target_lead_id;

  IF target_organization_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found or unauthorized.';
  END IF;

  IF target_organization_id IS DISTINCT FROM caller_profile.organization_id
     AND caller_profile.role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Lead not found or unauthorized.';
  END IF;

  RETURN public.get_telecaller_student_detail_legacy(target_lead_id);
END;
$expected_body$;
BEGIN
  -- The PowerShell wrapper selects the exact verified container. Confirm its
  -- PostgreSQL session identity again before reading or writing migration state.
  IF current_database() IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR current_setting('server_version_num')::integer IS DISTINCT FROM 170011
     OR current_setting('port') IS DISTINCT FROM '5432' THEN
    RAISE EXCEPTION 'Refusing reconciliation: unexpected database identity';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
    RAISE EXCEPTION 'Refusing reconciliation: required Supabase API roles are missing';
  END IF;

  v_history_oid := pg_catalog.to_regclass('supabase_migrations.schema_migrations')::oid;
  IF v_history_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
     WHERE c.oid=v_history_oid AND c.relkind='r'
  ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration history table is missing or not an ordinary table';
  END IF;

  -- Require the verified version/text[]/name shape, version NOT NULL, and no
  -- defaults, identities, generated columns, or extra constraints.
  SELECT count(*) INTO v_column_count
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=v_history_oid AND a.attnum>0 AND NOT a.attisdropped;

  IF v_column_count IS DISTINCT FROM 3
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=v_history_oid AND a.attname='version'
          AND a.attnum>0 AND NOT a.attisdropped
          AND a.atttypid='pg_catalog.text'::pg_catalog.regtype
          AND a.attnotnull AND a.attidentity='' AND a.attgenerated=''
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=v_history_oid AND a.attname='statements'
          AND a.attnum>0 AND NOT a.attisdropped
          AND a.atttypid='pg_catalog.text[]'::pg_catalog.regtype
          AND NOT a.attnotnull AND a.attidentity='' AND a.attgenerated=''
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=v_history_oid AND a.attname='name'
          AND a.attnum>0 AND NOT a.attisdropped
          AND a.atttypid='pg_catalog.text'::pg_catalog.regtype
          AND NOT a.attnotnull AND a.attidentity='' AND a.attgenerated=''
     )
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=v_history_oid) THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration history columns/defaults differ from the verified schema';
  END IF;

  SELECT a.attnum INTO v_version_attnum
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=v_history_oid AND a.attname='version'
     AND a.attnum>0 AND NOT a.attisdropped;

  SELECT count(*) INTO v_constraint_count
    FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_history_oid;
  SELECT count(*) INTO v_primary_key_count
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid=v_history_oid AND c.contype='p'
     AND c.conkey=ARRAY[v_version_attnum]::smallint[];

  IF v_constraint_count IS DISTINCT FROM 1 OR v_primary_key_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration history constraints differ from version PRIMARY KEY';
  END IF;

  -- Confirm the prerequisite migration is present before recording this one.
  SELECT count(*) INTO v_history_count
    FROM supabase_migrations.schema_migrations h
   WHERE h.version='20261031140000';
  IF v_history_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration 20261031140000 history count is %, expected exactly one', v_history_count;
  END IF;

  -- Serialize migration-history writers before checking for a duplicate.
  LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_history_count
    FROM supabase_migrations.schema_migrations h
   WHERE h.version='20261031130000';
  IF v_history_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Refusing reconciliation: version 20261031130000 is already present (count=%)', v_history_count;
  END IF;

  -- Ensure the one INSERT cannot invoke additional persistent side effects.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid=v_history_oid AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_rewrite r
     WHERE r.ev_class=v_history_oid AND r.rulename <> '_RETURN'
  ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: migration history table has enabled user triggers or rewrite rules';
  END IF;

  -- All lead/call SECURITY DEFINER functions asserted by the migration's
  -- regression test must retain postgres ownership and SECURITY DEFINER.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.guard_org_lead_phone_write()'::regprocedure,
    'public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)'::regprocedure,
    'public.import_owner_leads(uuid,uuid,uuid,jsonb)'::regprocedure,
    'public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)'::regprocedure,
    'public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
    'public.update_assigned_telecaller_lead(uuid,text,text)'::regprocedure,
    'public.initiate_authorized_call(uuid)'::regprocedure,
    'public.get_telecaller_student_detail(uuid)'::regprocedure
  ] LOOP
    SELECT p.proowner, p.prosecdef INTO v_owner, v_is_security_definer
      FROM pg_catalog.pg_proc p WHERE p.oid=v_signature::oid;
    IF NOT FOUND OR v_owner IS DISTINCT FROM 'postgres'::pg_catalog.regrole::oid
       OR v_is_security_definer IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Refusing reconciliation: expected postgres-owned SECURITY DEFINER function %', v_signature;
    END IF;
  END LOOP;

  v_function_oid := pg_catalog.to_regprocedure('public.initiate_authorized_call(uuid)')::oid;
  SELECT p.proconfig INTO v_proconfig
    FROM pg_catalog.pg_proc p WHERE p.oid=v_function_oid;
  IF NOT FOUND OR v_proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'Refusing reconciliation: initiate_authorized_call search_path differs from migration 130000';
  END IF;

  -- Match the exact function metadata and body defined by migration 130000.
  v_function_oid := pg_catalog.to_regprocedure('public.get_telecaller_student_detail(uuid)')::oid;
  SELECT p.proowner, p.prosecdef, p.proconfig, p.prosrc, p.prorettype, l.lanname,
         p.proargnames, p.provolatile, p.proisstrict, p.proparallel
    INTO v_owner, v_is_security_definer, v_proconfig, v_prosrc, v_return_type,
         v_language, v_argument_names, v_volatility, v_strict, v_parallel
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=v_function_oid;

  IF v_function_oid IS NULL OR NOT FOUND
     OR v_owner IS DISTINCT FROM 'postgres'::pg_catalog.regrole::oid
     OR v_is_security_definer IS DISTINCT FROM true
     OR v_proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
     OR v_return_type IS DISTINCT FROM 'pg_catalog.jsonb'::pg_catalog.regtype::oid
     OR v_language IS DISTINCT FROM 'plpgsql'
     OR v_argument_names IS DISTINCT FROM ARRAY['target_lead_id']::text[]
     OR v_volatility IS DISTINCT FROM 'v'
     OR v_strict IS DISTINCT FROM false
     OR v_parallel IS DISTINCT FROM 'u'
     OR replace(replace(v_prosrc, chr(13)||chr(10), chr(10)), chr(13), chr(10))
        IS DISTINCT FROM replace(replace(v_expected_detail_body, chr(13)||chr(10), chr(10)), chr(13), chr(10)) THEN
    RAISE EXCEPTION 'Refusing reconciliation: get_telecaller_student_detail definition differs from migration 130000';
  END IF;

  -- Verify service_role's exact table SELECT ACL and lack of table UPDATE or
  -- other direct table privileges; anon/authenticated have no direct access.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
     WHERE c.oid='public.leads'::pg_catalog.regclass
       AND x.grantee IN (0,'anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole)
  ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: PUBLIC/anon/authenticated has stored public.leads table ACL entries';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c
       CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
      WHERE c.oid='public.leads'::pg_catalog.regclass
        AND x.grantee='service_role'::pg_catalog.regrole) IS DISTINCT FROM 1
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
        WHERE c.oid='public.leads'::pg_catalog.regclass
          AND x.grantee='service_role'::pg_catalog.regrole
          AND (x.privilege_type <> 'SELECT' OR x.is_grantable)
     ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: service_role table ACL is not exactly non-grantable SELECT';
  END IF;

  FOR v_function IN
    SELECT r.role_name, p.privilege_name
      FROM (VALUES ('anon'),('authenticated')) r(role_name)
     CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege_name)
  LOOP
    IF pg_catalog.has_table_privilege(v_function.role_name,'public.leads',v_function.privilege_name) THEN
      RAISE EXCEPTION 'Refusing reconciliation: % retains % on public.leads', v_function.role_name, v_function.privilege_name;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege('service_role','public.leads','SELECT')
     OR pg_catalog.has_table_privilege('service_role','public.leads','UPDATE')
     OR pg_catalog.has_table_privilege('service_role','public.leads','INSERT')
     OR pg_catalog.has_table_privilege('service_role','public.leads','DELETE')
     OR pg_catalog.has_table_privilege('service_role','public.leads','TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role','public.leads','REFERENCES')
     OR pg_catalog.has_table_privilege('service_role','public.leads','TRIGGER')
     OR pg_catalog.has_table_privilege('service_role','public.leads','MAINTAIN') THEN
    RAISE EXCEPTION 'Refusing reconciliation: service_role effective public.leads table privileges differ from target';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
     WHERE a.attrelid='public.leads'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped
       AND x.grantee IN (0,'anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole)
  ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: PUBLIC/anon/authenticated has stored public.leads column ACL entries';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_attribute a
       CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
      WHERE a.attrelid='public.leads'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped
        AND x.grantee='service_role'::pg_catalog.regrole) IS DISTINCT FROM 5
     OR (SELECT count(DISTINCT a.attname) FROM pg_catalog.pg_attribute a
          CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
         WHERE a.attrelid='public.leads'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped
           AND x.grantee='service_role'::pg_catalog.regrole) IS DISTINCT FROM 5
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
        WHERE a.attrelid='public.leads'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped
          AND x.grantee='service_role'::pg_catalog.regrole
          AND (a.attname NOT IN ('assigned_to','status','updated_at','priority','notes')
               OR x.privilege_type <> 'UPDATE' OR x.is_grantable)
     ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: service_role column ACL differs from the five-column UPDATE allowlist';
  END IF;

  FOR v_function IN
    SELECT r.role_name, a.attname, p.privilege_name
      FROM (VALUES ('anon'),('authenticated')) r(role_name)
      CROSS JOIN pg_catalog.pg_attribute a
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege_name)
     WHERE a.attrelid='public.leads'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped
  LOOP
    IF pg_catalog.has_column_privilege(v_function.role_name,'public.leads',v_function.attname,v_function.privilege_name) THEN
      RAISE EXCEPTION 'Refusing reconciliation: % retains % on public.leads.%', v_function.role_name, v_function.privilege_name, v_function.attname;
    END IF;
  END LOOP;

  FOR v_function IN
    SELECT a.attname FROM pg_catalog.pg_attribute a
     WHERE a.attrelid='public.leads'::pg_catalog.regclass AND a.attnum>0 AND NOT a.attisdropped
  LOOP
    IF pg_catalog.has_column_privilege('service_role','public.leads',v_function.attname,'UPDATE')
       IS DISTINCT FROM (v_function.attname IN ('assigned_to','status','updated_at','priority','notes')) THEN
      RAISE EXCEPTION 'Refusing reconciliation: service_role effective UPDATE allowlist differs at public.leads.%',v_function.attname;
    END IF;
  END LOOP;

  -- Verify postgres public/global defaults as required by migration 130000.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
     WHERE d.defaclrole='postgres'::pg_catalog.regrole
       AND d.defaclnamespace=pg_catalog.to_regnamespace('public')::oid
       AND d.defaclobjtype IN ('r','S','f')
       AND (x.grantee IN ('anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole,'service_role'::pg_catalog.regrole)
         OR (d.defaclobjtype IN ('r','S') AND x.grantee=0)
         OR (d.defaclobjtype='f' AND x.grantee=0 AND x.privilege_type='EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: postgres public-schema default ACLs do not match target';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
     WHERE d.defaclrole='postgres'::pg_catalog.regrole AND d.defaclnamespace='0'::oid
       AND d.defaclobjtype IN ('r','S','f')
       AND (x.grantee IN ('anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole,'service_role'::pg_catalog.regrole)
         OR (d.defaclobjtype IN ('r','S') AND x.grantee=0)
         OR (d.defaclobjtype='f' AND x.grantee=0 AND x.privilege_type='EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'Refusing reconciliation: postgres global default ACL preflight is not clear';
  END IF;

  -- Check the intended RPC execution matrix from the migration regression test.
  FOR v_function IN
    SELECT * FROM (VALUES
      ('public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)', 'service_role', true),
      ('public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)', 'anon', false),
      ('public.create_owner_lead(uuid,uuid,text,text,text,text,text,text,uuid)', 'authenticated', false),
      ('public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'service_role', true),
      ('public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'anon', false),
      ('public.import_owner_leads(uuid,uuid,uuid,jsonb)', 'authenticated', false),
      ('public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)', 'service_role', true),
      ('public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)', 'anon', false),
      ('public.server_get_assigned_telecaller_leads(uuid,uuid,uuid)', 'authenticated', false),
      ('public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)', 'service_role', true),
      ('public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)', 'anon', false),
      ('public.server_update_assigned_telecaller_lead(uuid,uuid,uuid,uuid,text,text)', 'authenticated', false),
      ('public.update_assigned_telecaller_lead(uuid,text,text)', 'authenticated', true),
      ('public.update_assigned_telecaller_lead(uuid,text,text)', 'anon', false),
      ('public.get_telecaller_student_detail(uuid)', 'authenticated', true),
      ('public.get_telecaller_student_detail(uuid)', 'anon', false),
      ('public.initiate_authorized_call(uuid)', 'authenticated', false),
      ('public.initiate_authorized_call(uuid)', 'anon', false),
      ('public.initiate_authorized_call(uuid)', 'service_role', false)
    ) AS expected(signature, role_name, expected_execute)
  LOOP
    v_function_oid := pg_catalog.to_regprocedure(v_function.signature)::oid;
    IF v_function_oid IS NULL
       OR pg_catalog.has_function_privilege(v_function.role_name,v_function_oid,'EXECUTE') IS DISTINCT FROM v_function.expected_execute THEN
      RAISE EXCEPTION 'Refusing reconciliation: EXECUTE mismatch for % role %',v_function.signature,v_function.role_name;
    END IF;
  END LOOP;

  -- Do not alter or normalize supabase_admin defaults. The script has no ACL
  -- DDL; only the one history row below can persist.
  INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
  VALUES ('20261031130000', NULL, 'public_leads_privilege_hardening');
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Expected exactly one history row insert, got %',v_inserted;
  END IF;

  SELECT count(*) INTO v_history_count
    FROM supabase_migrations.schema_migrations h
   WHERE h.version='20261031130000'
     AND h.name='public_leads_privilege_hardening'
     AND h.statements IS NULL;
  IF v_history_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'History row verification failed; expected one correctly named record, got %',v_history_count;
  END IF;
END;
$reconcile$;

COMMIT;
